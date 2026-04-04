// pages/game/game.js
const db = wx.cloud.database();

Page({
  data: {
    roomId: '',
    roomCode: '',
    openid: '',
    ownerOpenid: '',   // 存进 data，供 wxml 直接比较 + 调试

    /* 房间级 */
    maxPlayers: 4,
    roundTime: 0,
    totalRounds: 0,
    timeLeft: 0,
    currentRound: 0,
    isOwner: false,
    canStartGame: false,
    gameStatus: 'waiting',

    gameId: '',

    /* 回合级 */
    currentRoundId: '',
    roundStatus: 'idle',   // idle / choosing / drawing / ended
    drawerWord: '',        // 词条仅画手可见
    currentDrawer: '',
    currentDrawerNickName: '',
    isDrawer: false,

    /* 画手出题输入 */
    wordInput: '',

    /* 画布 */
    canvasContext: null,
    selectedTool: 'pen',
    isDrawing: false,
    drawingBuffer: [],

    /* 玩家 & 聊天 */
    players: [],
    messages: [],
    chatInput: '',
    canSendMessage: false,

    /* 结束页 */
    currentUserReady: false,
    showGameOver: false,
    finalScores: [],
    canSubmitWord: false
  },

  /* ================= 工具函数：主动拉一次房间 ================= */
  async fetchRoomOnce() {
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'getRoomInfo',
        data: { roomId: this.data.roomId }
      });
      if (result && result.success && result.room) {
        this.onRoomSnapshot({ docs: [result.room] });
        console.log('[fetchRoomOnce] OK, ownerOpenid=', result.room.ownerOpenid, 'myOpenid=', this.data.openid);
      } else {
        console.error('[fetchRoomOnce] failed:', result && result.errMsg);
      }
    } catch (e) {
      console.error('[fetchRoomOnce] exception:', e);
    }
  },

  /* ================= 微信小程序-生命周期函数 ================= */
  async onLoad(options) {
    const { roomCode, roomId } = options;
    if (!roomId) {
      wx.showToast({ title: '缺少房间ID', icon: 'none' });
      wx.navigateBack();
      return;
    }

    await getApp().getUserInfoReady();
    const { userInfo, openid } = getApp().globalData;
    if (!userInfo || !openid) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.navigateBack();
      return;
    }

    this.setData({ roomId, roomCode, openid });
    this.initCanvas();

    // 1. 先建 watcher（建立时立即推送快照）
    this.roomWatcher = db.collection('room').doc(roomId).watch({
      onChange: snapshot => this.onRoomSnapshot(snapshot),
      onError: e => {
        console.error('[room watch error]', e);
        this.fetchRoomOnce();
      }
    });

    // 2. 主动拉一次，兜底 watcher 首次快照延迟
    await this.fetchRoomOnce();

    // 3. 入房（幂等；房主 createRoom 时已写入，此处直接 skip）
    try {
      await wx.cloud.callFunction({
        name: 'enterRoom',
        data: { roomCode, nickName: userInfo.nickname, avatarUrl: userInfo.avatarUrl }
      });
      console.log('[onLoad] enterRoom 完成');
    } catch (e) {
      console.error('[onLoad] enterRoom 失败:', e);
    }

    // 4. 再拉一次，确保玩家加入后房主端立即同步
    await this.fetchRoomOnce();
  },

  // 页面重新显示时补拉（处理后台切回前台场景）
  async onShow() {
    if (this.data.roomId) {
      await this.fetchRoomOnce();
    }
  },

  // 卸载生命周期函数
  onUnload() {
    this.roomWatcher && this.roomWatcher.close();
    this.roundWatcher && this.roundWatcher.close();
    this.clearTimer();
  },

  /* ================= 实时数据：房间快照 ================= */
  onRoomSnapshot(snapshot) {
    const doc = snapshot.docs[0];
    if (!doc) return;

    const openid = this.data.openid;
    const players = doc.players || [];
    const ownerOpenid = doc.ownerOpenid || this.data.ownerOpenid || ((players.length === 1 && players[0].openid) ? players[0].openid : '');
    const roomStatus = doc.status || this.data.gameStatus || 'waiting';
    const isOwner = !!(ownerOpenid && ownerOpenid === openid);
    const isDrawer = !!(doc.currentDrawer && doc.currentDrawer === openid);
    const me = players.find(p => p.openid === openid);

    // canStartGame: 房主 + 至少1名其他玩家 + 所有其他玩家已准备
    const nonHostPlayers = players.filter(p => p.openid !== ownerOpenid);
    const canStartGame = isOwner &&
      nonHostPlayers.length > 0 &&
      nonHostPlayers.every(p => !!p.isReady);

    this.setData({
      ownerOpenid,
      maxPlayers: doc.maxPlayers,
      roundTime: doc.roundTime,
      totalRounds: doc.totalRounds,
      gameStatus: roomStatus,
      currentRound: doc.currentRoundIdx || 0,
      currentDrawer: doc.currentDrawer || '',
      currentRoundId: doc.currentRoundId || '',
      players,
      isOwner,
      isDrawer,
      canStartGame,
      currentUserReady: !!(me && me.isReady),
    });

    // 当前画手昵称
    const drawerPlayer = players.find(p => p.openid === doc.currentDrawer);
    this.setData({ currentDrawerNickName: drawerPlayer ? drawerPlayer.nickName : '' });

    // waiting 状态：重置所有回合相关状态
    if (roomStatus === 'waiting') {
      this.clearTimer();
      this._lastEndAt = null;
      this.refreshRoundWatcher('');
      this.setData({ timeLeft: 0, roundStatus: 'idle', drawerWord: '', messages: [] });
    }

    // 回合监听
    if (roomStatus === 'playing') {
      this.refreshRoundWatcher(doc.currentRoundId);
    }

    // 倒计时：endAt 变化，画手提交词 → 启动计时 & 切 drawing
    if (roomStatus === 'playing' && doc.endAt) {
      if (doc.endAt !== this._lastEndAt) {
        this._lastEndAt = doc.endAt;
        this.setData({ roundStatus: 'drawing' });
        const left = Math.max(0, Math.floor((doc.endAt - Date.now()) / 1000));
        this.setData({ timeLeft: left });
        this.startTimer(doc.endAt);
        console.log('[onRoomSnapshot] 计时器启动 endAt=', doc.endAt);
      }
    } else if (roomStatus === 'playing' && !doc.endAt && this._lastEndAt) {
      // 新回合开始（choosing），重置计时
      this._lastEndAt = null;
      this.clearTimer();
      this.setData({ timeLeft: 0 });
    }

    if (roomStatus === 'finished') {
      this.endGame(doc.totalScore);
    }

    this.drawAllStrokes(doc.strokes || []);

    console.log('[onRoomSnapshot] status=', roomStatus,
      '| isOwner=', isOwner,
      '| openid=', openid,
      '| ownerOpenid=', ownerOpenid,
      '| players=', players.length);
  },

  drawAllStrokes(strokes) {
    const ctx = this.data.canvasContext;
    if (!ctx || !strokes || !strokes.length) return;
    ctx.clearRect(0, 0, 300, 200);
    strokes.forEach(stroke => {
      if (!stroke.points || stroke.points.length < 2) return;
      ctx.setStrokeStyle(stroke.color);
      ctx.setLineWidth(stroke.width);
      ctx.setLineCap('round');
      ctx.beginPath();
      stroke.points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    });
    ctx.draw(true);
  },

  /* ================= 实时数据：回合快照 ================= */
  refreshRoundWatcher(roundId) {
    if (!roundId) {
      if (this.roundWatcher) { this.roundWatcher.close(); this.roundWatcher = null; }
      this._currentWatchRoundId = '';
      return;
    }
    if (this._currentWatchRoundId === roundId) return;
    if (this.roundWatcher) this.roundWatcher.close();
    this._currentWatchRoundId = roundId;

    this.roundWatcher = db.collection('rounds').doc(roundId).watch({
      onChange: snap => {
        const round = snap.docs[0];
        if (!round) return;

        const { isDrawer, roundStatus } = this.data;

        // 同步回合状态（only forward: choosing → drawing → ended）
        if (round.status && round.status !== roundStatus) {
          this.setData({ roundStatus: round.status });
          console.log('[roundWatcher] roundStatus ->', round.status);
        }

        // 画手才能看词
        if (isDrawer && round.word) {
          if (round.word !== this.data.drawerWord) {
            this.setData({ drawerWord: round.word });
          }
        } else if (!isDrawer) {
          this.setData({ drawerWord: '' });
        }

        // 猜词转消息格式
        const players = this.data.players;
        const messages = (round.guesses || []).map(g => {
          const p = players.find(pl => pl.openid === g.openid);
          const sender = p ? p.nickName : '玩家';
          return g.isCorrect
            ? { type: 'correct', sender, content: g.text }
            : { type: 'chat', sender, content: g.text };
        });
        this.setData({ messages });
      },
      onError: e => console.error('[round watch error]', e)
    });
  },

  /* ================= 画布 ================= */
  initCanvas() {
    const ctx = wx.createCanvasContext('drawingCanvas', this);
    ctx.setLineCap('round');
    ctx.setLineJoin('round');
    ctx.setLineWidth(3);
    ctx.setStrokeStyle('#000000');
    this.setData({ canvasContext: ctx });
  },

  selectTool(e) {
    const tool = e.currentTarget.dataset.tool;
    this.setData({ selectedTool: tool });
    const ctx = this.data.canvasContext;
    if (tool === 'pen') { ctx.setStrokeStyle('#000000'); ctx.setLineWidth(3); }
    else if (tool === 'eraser') { ctx.setStrokeStyle('#ffffff'); ctx.setLineWidth(10); }
  },

  clearCanvas() {
    const ctx = this.data.canvasContext;
    ctx.clearRect(0, 0, 300, 200);
    ctx.draw(true);
    wx.cloud.callFunction({ name: 'clearStrokes', data: { roomId: this.data.roomId } });
  },

  /* ================= 绘图事件 ================= */
  onTouchStart(e) {
    if (!this.data.isDrawer || this.data.roundStatus !== 'drawing') return;
    const { x, y } = e.touches[0];
    this.setData({ isDrawing: true, drawingBuffer: [{ x, y }] });
  },

  onTouchMove(e) {
    if (!this.data.isDrawing) return;
    const { x, y } = e.touches[0];
    const ctx = this.data.canvasContext;
    const buf = this.data.drawingBuffer;
    const last = buf[buf.length - 1];
    const isPen = this.data.selectedTool === 'pen';
    ctx.setStrokeStyle(isPen ? '#000000' : '#ffffff');
    ctx.setLineWidth(isPen ? 3 : 10);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.draw(true);
    this.setData({ drawingBuffer: [...buf, { x, y }] });
  },

  onTouchEnd() {
    if (!this.data.isDrawing) return;
    this.setData({ isDrawing: false });
    const isPen = this.data.selectedTool === 'pen';
    wx.cloud.callFunction({
      name: 'sendStroke',
      data: {
        roomId: this.data.roomId,
        stroke: {
          color: isPen ? '#000000' : '#ffffff',
          width: isPen ? 3 : 10,
          points: this.data.drawingBuffer
        }
      }
    });
    this.setData({ drawingBuffer: [] });
  },

  /* ================= 画手出题 ================= */
  onWordInput(e) {
    const wordInput = e.detail.value || '';
    this.setData({ wordInput, canSubmitWord: !!wordInput.trim() });
  },

  async submitWord() {
    const word = this.data.wordInput.trim();
    if (!word) return;
    wx.showLoading({ title: '提交中' });
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'submitWord',
        data: { roomId: this.data.roomId, roundId: this.data.currentRoundId, word }
      });
      if (!result.success) {
        wx.showToast({ title: result.errMsg || '提交失败', icon: 'none' });
      } else {
        // 本地直接切换，不等 watcher 回调
        this.setData({ wordInput: '', canSubmitWord: false, drawerWord: word, roundStatus: 'drawing' });
        console.log('[submitWord] 已提交:', word);
      }
    } catch (e) {
      console.error('[submitWord] error:', e);
      wx.showToast({ title: '提交失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  /* ================= 聊天 ================= */
  onChatInput(e) {
    const chatInput = e.detail.value || '';
    this.setData({ chatInput, canSendMessage: !!chatInput.trim() });
  },

  async sendMessage() {
    const text = this.data.chatInput.trim();
    if (!text || this.data.isDrawer) return;
    this.setData({ chatInput: '', canSendMessage: false });
    try {
      await wx.cloud.callFunction({
        name: 'sendGuess',
        data: { roomCode: this.data.roomCode, text }
      });
    } catch (e) {
      console.error('[sendMessage] error:', e);
    }
  },

  /* ================= 房主点击-开始游戏 ================= */
  async startGame() {
    if (!this.data.isOwner) {
      wx.showToast({ title: '只有房主才能开始', icon: 'none' });
      return;
    }
    if (this.data.gameStatus !== 'waiting') return;
    if (!this.data.canStartGame) {
      wx.showToast({ title: '请等待所有玩家准备', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '准备中' });
    try {
      // 1. 房间状态 → playing
      const startRes = await wx.cloud.callFunction({
        name: 'startGame',
        data: { roomId: this.data.roomId }
      });
      if (!startRes.result.success) {
        wx.showToast({ title: startRes.result.errMsg || '开始失败', icon: 'none' });
        wx.hideLoading();
        return;
      }
      this.setData({ gameStatus: 'playing' });

      // 2. 创建 games 记录（失败不阻塞）
      try {
        const createRes = await wx.cloud.callFunction({
          name: 'createGame',
          data: { roomId: this.data.roomId, roomCode: this.data.roomCode, players: this.data.players }
        });
        if (createRes.result && createRes.result.gameId) {
          this.setData({ gameId: createRes.result.gameId });
        }
      } catch (e) {
        console.warn('[startGame] createGame 失败，不阻塞:', e);
      }

      // 3. 开始第 1 回合
      const players = this.data.players;
      if (!players.length) {
        wx.showToast({ title: '房间玩家为空', icon: 'none' });
        wx.hideLoading();
        return;
      }
      const firstDrawer = players[0].openid;
      const roundRes = await wx.cloud.callFunction({
        name: 'startRound',
        data: { roomId: this.data.roomId, roundIdx: 1, drawer: firstDrawer }
      });
      const { roundId, drawer } = roundRes.result;

      // 4. 直接更新本地状态，不等 watcher
      const drawerPlayer = players.find(p => p.openid === drawer);
      this.setData({
        currentRoundId: roundId,
        currentRound: 1,
        currentDrawer: drawer,
        currentDrawerNickName: drawerPlayer ? drawerPlayer.nickName : '',
        isDrawer: drawer === this.data.openid,
        roundStatus: 'choosing',
      });
      this._currentWatchRoundId = null; // 强制重建 watcher
      this.refreshRoundWatcher(roundId);

      console.log('[startGame] 开始，画手:', drawer, 'roundId:', roundId);
      wx.hideLoading();
    } catch (e) {
      wx.hideLoading();
      console.error('[startGame] error:', e);
      wx.showToast({ title: String(e.errMsg || e.message || '开始失败'), icon: 'none' });
    }
  },

  /* ================= 倒计时 ================= */
  startTimer(endAt) {
    this.clearTimer();
    this.timer = setInterval(() => {
      const left = Math.max(0, Math.floor((endAt - Date.now()) / 1000));
      this.setData({ timeLeft: left });
      if (left <= 0) {
        this.clearTimer();
        wx.showToast({ title: '时间到！', icon: 'none' });
        if (this.data.isOwner) this.triggerEndRound();
      }
    }, 1000);
  },

  clearTimer() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  },

  async triggerEndRound() {
    const { roomId, currentRoundId } = this.data;
    if (!currentRoundId) return;
    console.log('[triggerEndRound] roundId=', currentRoundId);
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'endRound',
        data: { roomId, roundId: currentRoundId }
      });
      console.log('[triggerEndRound]', result);
    } catch (e) {
      console.error('[triggerEndRound] error:', e);
    }
  },

  /* ================= 结束页 ================= */
  endGame(totalScore) {
    this.clearTimer();
    const players = this.data.players;
    const arr = Object.entries(totalScore || {}).map(([oid, score]) => {
      const p = players.find(pl => pl.openid === oid);
      return { openid: oid, nickName: p ? p.nickName : '未知', score };
    });
    arr.sort((a, b) => b.score - a.score);
    this.setData({ finalScores: arr, showGameOver: true });
  },

  /* ================= 导航 ================= */
  backToHome() { wx.navigateBack({ delta: 2 }); },
  playAgain() { this.backToHome(); },

  /* ================= 准备（仅非房主） ================= */
  async handleReady() {
    if (this.data.isOwner) return;
    if (this.data.gameStatus !== 'waiting') return;
    if (this.data.currentUserReady) return;
    const { openid, roomId } = this.data;
    try {
      await wx.cloud.callFunction({ name: 'setPlayerReady', data: { roomId, openid } });
      this.setData({ currentUserReady: true });
      await this.fetchRoomOnce();
      console.log('[handleReady] 已准备');
    } catch (e) {
      console.error('[handleReady] error:', e);
    }
  },
});

// pages/game/game.js
const db = wx.cloud.database();
const CANVAS_BG_COLOR = '#fffaf1';

Page({
  data: {
    roomId: '',
    roomCode: '',
    openid: '',
    ownerOpenid: '',

    // 房间状态
    maxPlayers: 4,
    roundTime: 0,
    totalRounds: 0,
    timeLeft: 0,
    currentRound: 0,
    isOwner: false,
    canStartGame: false,
    gameStatus: 'waiting',   // waiting / playing / finished

    // 回合状态
    currentRoundId: '',
    roundStatus: 'idle',     // idle / choosing / drawing / ended
    drawerWord: '',
    currentDrawer: '',
    currentDrawerNickName: '',
    isDrawer: false,

    // 画手出题
    wordInput: '',
    canSubmitWord: false,

    // 画布
    canvasContext: null,
    canvasWidth: 300,
    canvasHeight: 200,
    selectedTool: 'pen',
    isDrawing: false,
    drawingBuffer: [],

    // 玩家 & 聊天
    players: [],
    messages: [],
    chatInput: '',
    canSendMessage: false,

    // UI
    currentUserReady: false,
    showGameOver: false,
    finalScores: [],
    showRoundReveal: false,
    roundRevealWord: '',
    roundRevealDrawer: '',
    roundRevealRound: 0,
  },

  /* ==================== 数据同步 ==================== */

  // 通过云函数拉取房间数据（轮询 + 兜底）
  async fetchRoomOnce() {
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'getRoomInfo',
        data: { roomId: this.data.roomId }
      });
      if (result && result.success && result.room) {
        this.processRoomData(result.room);
      }
    } catch (e) {
      console.error('[fetchRoomOnce]', e);
    }
  },

  // 处理房间数据（watcher 和轮询共用）
  processRoomData(doc) {
    if (!doc) return;

    const openid = this.data.openid;
    const players = doc.players || [];
    const ownerOpenid = doc.ownerOpenid || '';
    const roomStatus = doc.status || 'waiting';
    const lastRoundSummary = doc.lastRoundSummary || null;
    const isOwner = !!(ownerOpenid && ownerOpenid === openid);
    const isDrawer = !!(doc.currentDrawer && doc.currentDrawer === openid);
    const me = players.find(p => p.openid === openid);

    // 是否可以开始游戏：房主 + 至少1人 + 全部准备
    const nonHostPlayers = players.filter(p => p.openid !== ownerOpenid);
    const canStartGame = isOwner &&
      nonHostPlayers.length > 0 &&
      nonHostPlayers.every(p => !!p.isReady);

    const drawerPlayer = players.find(p => p.openid === doc.currentDrawer);

    this.setData({
      ownerOpenid,
      maxPlayers: doc.maxPlayers,
      roundTime: doc.roundTime,
      totalRounds: doc.totalRounds,
      gameStatus: roomStatus,
      currentRound: doc.currentRoundIdx || 0,
      currentDrawer: doc.currentDrawer || '',
      currentDrawerNickName: drawerPlayer ? drawerPlayer.nickName : '',
      currentRoundId: doc.currentRoundId || '',
      players,
      isOwner,
      isDrawer,
      canStartGame,
      currentUserReady: !!(me && me.isReady),
    }, () => {
      // The canvas area changes height when placeholders/toolbars appear or disappear.
      // Re-measure after state updates so the drawable area matches the visible panel.
      this.syncCanvasSize();
    });

    // waiting: 重置回合状态
    if (roomStatus === 'waiting') {
      this.clearTimer();
      this._lastEndAt = null;
      this.stopRoundWatcher();
      this._confirmedStrokes = [];
      this._confirmedStrokeCount = 0;
      this._pendingStrokes = [];
      this._activeStroke = null;
      this.setData({ timeLeft: 0, roundStatus: 'idle', drawerWord: '', messages: [], showRoundReveal: false }, () => this.syncCanvasSize());
    }

    // playing: 启动回合监听 + 推断回合阶段
    if (roomStatus === 'playing') {
      this.startRoundWatcher(doc.currentRoundId);
      // endAt 为空且回合已创建 → 出题阶段；endAt 存在 → 画画阶段（下面处理）
      if (!doc.endAt && doc.currentRoundId) {
        this.setData({ roundStatus: 'choosing' }, () => this.syncCanvasSize());
      }
    }

    // 倒计时：endAt 变化时启动计时器
    if (roomStatus === 'playing' && doc.endAt) {
      if (doc.endAt !== this._lastEndAt) {
        this._lastEndAt = doc.endAt;
        this.setData({ roundStatus: 'drawing' }, () => this.syncCanvasSize());
        const left = Math.max(0, Math.floor((doc.endAt - Date.now()) / 1000));
        this.setData({ timeLeft: left });
        this.startTimer(doc.endAt);
      }
    } else if (roomStatus === 'playing' && !doc.endAt) {
      // 出题阶段 or 新回合开始，重置计时
      this._lastEndAt = null;
      this.clearTimer();
      this.setData({ timeLeft: 0 }, () => this.syncCanvasSize());
    }

    // finished: 显示结算
    if (roomStatus === 'finished') {
      this._pendingStrokes = [];
      this._activeStroke = null;
      this.onGameFinished(players);
    }

    if (!this._hasHydratedRoom) {
      this._hasHydratedRoom = true;
      this._lastShownRoundSummaryId = lastRoundSummary ? lastRoundSummary.roundId : '';
    } else if (roomStatus === 'playing' && lastRoundSummary && lastRoundSummary.roundId !== this._lastShownRoundSummaryId) {
      this._lastShownRoundSummaryId = lastRoundSummary.roundId;
      this.showLastRoundReveal(lastRoundSummary);
    }

    // 只在笔画数据真正变化时重绘，避免房间其他字段变更清掉本地临时笔迹。
    const strokes = doc.strokes || [];
    const nextStrokeCount = strokes.length;
    const prevStrokeCount = typeof this._confirmedStrokeCount === 'number' ? this._confirmedStrokeCount : 0;
    const changed = this.haveStrokesChanged(strokes, this._confirmedStrokes || []);
    if (changed) {
      if (this.data.isDrawer && nextStrokeCount > prevStrokeCount && this._pendingStrokes && this._pendingStrokes.length) {
        this._pendingStrokes.splice(0, Math.min(nextStrokeCount - prevStrokeCount, this._pendingStrokes.length));
      }
      this.drawAllStrokes(strokes);
    }
  },

  /* ==================== 生命周期 ==================== */

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

    // 1. watcher（主通道）
    this.roomWatcher = db.collection('room').doc(roomId).watch({
      onChange: snapshot => {
        const doc = snapshot.docs && snapshot.docs[0];
        if (doc) this.processRoomData(doc);
      },
      onError: e => {
        console.error('[room watcher error]', e);
      }
    });

    // 2. 主动拉一次
    await this.fetchRoomOnce();

    // 3. 入房（幂等）
    try {
      await wx.cloud.callFunction({
        name: 'enterRoom',
        data: { roomCode, nickName: userInfo.nickname, avatarUrl: userInfo.avatarUrl }
      });
    } catch (e) {
      console.error('[enterRoom]', e);
    }

    // 4. 入房后再拉一次
    await this.fetchRoomOnce();

    // 5. 轮询兜底（每3秒）
    this._pollTimer = setInterval(() => this.fetchRoomOnce(), 3000);
  },

  async onShow() {
    if (this.data.roomId) await this.fetchRoomOnce();
  },

  onReady() {
    this.syncCanvasSize();
  },

  onUnload() {
    if (this.roomWatcher) this.roomWatcher.close();
    this.stopRoundWatcher();
    this.clearTimer();
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
  },

  showLastRoundReveal(summary) {
    this.setData({
      showRoundReveal: true,
      roundRevealWord: summary.word || '',
      roundRevealDrawer: summary.drawerNickName || '画手',
      roundRevealRound: summary.roundIdx || 0,
    });
  },

  hideRoundReveal() {
    this.setData({ showRoundReveal: false });
  },

  /* ==================== 回合监听 ==================== */

  startRoundWatcher(roundId) {
    if (!roundId || this._watchingRoundId === roundId) return;
    this.stopRoundWatcher();
    this._watchingRoundId = roundId;

    this.roundWatcher = db.collection('rounds').doc(roundId).watch({
      onChange: snap => {
        const round = snap.docs && snap.docs[0];
        if (!round) return;

        // 同步回合状态
        if (round.status && round.status !== this.data.roundStatus) {
          this.setData({ roundStatus: round.status }, () => this.syncCanvasSize());
        }

        // 画手看词
        if (this.data.isDrawer && round.word) {
          this.setData({ drawerWord: round.word }, () => this.syncCanvasSize());
        } else if (!this.data.isDrawer) {
          this.setData({ drawerWord: '' }, () => this.syncCanvasSize());
        }

        // 猜词 → 消息列表
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
      onError: e => console.error('[round watcher error]', e)
    });
  },

  stopRoundWatcher() {
    if (this.roundWatcher) {
      this.roundWatcher.close();
      this.roundWatcher = null;
    }
    this._watchingRoundId = '';
  },

  /* ==================== 画布 ==================== */

  initCanvas() {
    const ctx = wx.createCanvasContext('drawingCanvas', this);
    ctx.setLineCap('round');
    ctx.setLineJoin('round');
    ctx.setLineWidth(3);
    ctx.setStrokeStyle('#000000');
    this._confirmedStrokes = [];
    this._confirmedStrokeCount = 0;
    this._pendingStrokes = [];
    this._activeStroke = null;
    this.setData({ canvasContext: ctx });
    this.syncCanvasSize();
  },

  syncCanvasSize() {
    const query = wx.createSelectorQuery().in(this);
    query.select('.drawing-canvas').boundingClientRect();
    query.exec((res) => {
      const rect = res && res[0];
      if (!rect || !rect.width || !rect.height) return;

      const canvasWidth = Math.round(rect.width);
      const canvasHeight = Math.round(rect.height);
      const changed = canvasWidth !== this.data.canvasWidth || canvasHeight !== this.data.canvasHeight;

      if (!changed) return;

      this.setData({ canvasWidth, canvasHeight }, () => {
        this.renderCanvas();
      });
    });
  },

  selectTool(e) {
    this.setData({ selectedTool: e.currentTarget.dataset.tool });
  },

  clearCanvas() {
    const ctx = this.data.canvasContext;
    const { canvasWidth, canvasHeight } = this.data;
    this._confirmedStrokes = [];
    this._confirmedStrokeCount = 0;
    this._pendingStrokes = [];
    this._activeStroke = null;
    if (ctx) { ctx.clearRect(0, 0, canvasWidth, canvasHeight); ctx.draw(true); }
    wx.cloud.callFunction({ name: 'clearStrokes', data: { roomId: this.data.roomId } });
  },

  drawAllStrokes(strokes) {
    this._confirmedStrokes = (strokes || []).map(stroke => ({
      ...stroke,
      tool: stroke.tool || 'pen',
      points: (stroke.points || []).map(point => ({ x: point.x, y: point.y }))
    }));
    this._confirmedStrokeCount = this._confirmedStrokes.length;
    this.renderCanvas();
  },

  haveStrokesChanged(nextStrokes, prevStrokes) {
    if (nextStrokes.length !== prevStrokes.length) return true;
    for (let i = 0; i < nextStrokes.length; i += 1) {
      const next = nextStrokes[i] || {};
      const prev = prevStrokes[i] || {};
      if ((next.tool || 'pen') !== (prev.tool || 'pen')) return true;
      if ((next.color || '#000000') !== (prev.color || '#000000')) return true;
      if ((next.width || 3) !== (prev.width || 3)) return true;
      const nextPoints = next.points || [];
      const prevPoints = prev.points || [];
      if (nextPoints.length !== prevPoints.length) return true;
      for (let j = 0; j < nextPoints.length; j += 1) {
        if (nextPoints[j].x !== prevPoints[j].x || nextPoints[j].y !== prevPoints[j].y) return true;
      }
    }
    return false;
  },

  renderCanvas() {
    const ctx = this.data.canvasContext;
    const { canvasWidth, canvasHeight } = this.data;
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    (this._confirmedStrokes || []).forEach(stroke => this.paintStroke(ctx, stroke));
    (this._pendingStrokes || []).forEach(stroke => this.paintStroke(ctx, stroke));
    this.paintStroke(ctx, this._activeStroke);
    ctx.draw(true);
  },

  paintStroke(ctx, stroke) {
    if (!ctx || !stroke || !stroke.points || !stroke.points.length) return;
    const tool = stroke.tool || 'pen';
    const strokeColor = tool === 'eraser' ? CANVAS_BG_COLOR : (stroke.color || '#000000');
    if (stroke.points.length === 1) {
      const point = stroke.points[0];
      const size = Math.max(3, stroke.width || 3);
      ctx.setFillStyle(strokeColor);
      ctx.fillRect(point.x - size / 2, point.y - size / 2, size, size);
      return;
    }

    ctx.setStrokeStyle(strokeColor);
    ctx.setLineWidth(stroke.width || 3);
    ctx.setLineCap('round');
    ctx.setLineJoin('round');
    ctx.beginPath();
    stroke.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  },

  /* ==================== 绘图事件 ==================== */

  onTouchStart(e) {
    if (!this.data.isDrawer || this.data.roundStatus !== 'drawing') return;
    const { x, y } = e.touches[0];
    const isPen = this.data.selectedTool === 'pen';
    this._activeStroke = {
      tool: isPen ? 'pen' : 'eraser',
      color: '#000000',
      width: isPen ? 3 : 28,
      points: [{ x, y }]
    };
    this.renderCanvas();
    this.setData({ isDrawing: true, drawingBuffer: [] });
  },

  onTouchMove(e) {
    if (!this.data.isDrawing || !this._activeStroke) return;
    const { x, y } = e.touches[0];
    const ctx = this.data.canvasContext;
    const points = this._activeStroke.points;
    const last = points[points.length - 1];
    this._activeStroke.points.push({ x, y });
    if (!ctx || !last) {
      this.renderCanvas();
      return;
    }
    this.paintStroke(ctx, {
      tool: this._activeStroke.tool,
      color: this._activeStroke.color,
      width: this._activeStroke.width,
      points: [last, { x, y }]
    });
    ctx.draw(true);
  },

  onTouchEnd() {
    if (!this.data.isDrawing || !this._activeStroke) return;
    const stroke = {
      tool: this._activeStroke.tool,
      color: this._activeStroke.color,
      width: this._activeStroke.width,
      points: this._activeStroke.points.map(point => ({ x: point.x, y: point.y }))
    };
    this._pendingStrokes.push(stroke);
    this._activeStroke = null;
    this.setData({ isDrawing: false, drawingBuffer: [] });
    wx.cloud.callFunction({
      name: 'sendStroke',
      data: {
        roomId: this.data.roomId,
        stroke
      }
    });
  },

  /* ==================== 画手出题 ==================== */

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
      if (result.success) {
        this.setData(
          { wordInput: '', canSubmitWord: false, drawerWord: word, roundStatus: 'drawing' },
          () => this.syncCanvasSize()
        );
      } else {
        wx.showToast({ title: result.errMsg || '提交失败', icon: 'none' });
      }
    } catch (e) {
      console.error('[submitWord]', e);
      wx.showToast({ title: '提交失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  /* ==================== 猜词 ==================== */

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
      console.error('[sendMessage]', e);
    }
  },

  /* ==================== 准备（非房主） ==================== */

  async handleReady() {
    if (this.data.isOwner || this.data.gameStatus !== 'waiting' || this.data.currentUserReady) return;
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'setPlayerReady',
        data: { roomId: this.data.roomId, openid: this.data.openid }
      });
      if (result && result.success) {
        this.setData({ currentUserReady: true });
        await this.fetchRoomOnce();
      } else {
        wx.showToast({ title: (result && result.errMsg) || '准备失败', icon: 'none' });
      }
    } catch (e) {
      console.error('[handleReady]', e);
    }
  },

  /* ==================== 开始游戏（房主） ==================== */

  async startGame() {
    if (!this.data.isOwner || this.data.gameStatus !== 'waiting' || !this.data.canStartGame) return;

    wx.showLoading({ title: '准备中' });
    try {
      // 1. 切换房间状态
      const startRes = await wx.cloud.callFunction({
        name: 'startGame',
        data: { roomId: this.data.roomId }
      });
      if (!startRes.result.success) {
        wx.showToast({ title: startRes.result.errMsg || '开始失败', icon: 'none' });
        return;
      }

      // 2. 开始第一回合
      const players = this.data.players;
      const firstDrawer = players[Math.floor(Math.random() * players.length)].openid;
      const roundRes = await wx.cloud.callFunction({
        name: 'startRound',
        data: { roomId: this.data.roomId, roundIdx: 1, drawer: firstDrawer }
      });

      // 3. 直接设置本地状态，不等 watcher/轮询
      const roundId = roundRes.result.roundId;
      const drawerPlayer = players.find(p => p.openid === firstDrawer);
      this.setData({
        gameStatus: 'playing',
        currentRoundId: roundId,
        currentRound: 1,
        currentDrawer: firstDrawer,
        currentDrawerNickName: drawerPlayer ? drawerPlayer.nickName : '',
        isDrawer: firstDrawer === this.data.openid,
        roundStatus: 'choosing',
      });
      this.startRoundWatcher(roundId);
    } catch (e) {
      console.error('[startGame]', e);
      wx.showToast({ title: '开始失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  /* ==================== 倒计时 ==================== */

  startTimer(endAt) {
    this.clearTimer();
    this._gameTimer = setInterval(() => {
      const left = Math.max(0, Math.floor((endAt - Date.now()) / 1000));
      this.setData({ timeLeft: left });
      if (left <= 0) {
        this.clearTimer();
        // 房主负责触发结束回合
        if (this.data.isOwner) this.triggerEndRound();
      }
    }, 1000);
  },

  clearTimer() {
    if (this._gameTimer) { clearInterval(this._gameTimer); this._gameTimer = null; }
  },

  async triggerEndRound() {
    const { roomId, currentRoundId } = this.data;
    if (!currentRoundId) return;
    try {
      await wx.cloud.callFunction({
        name: 'endRound',
        data: { roomId, roundId: currentRoundId }
      });
    } catch (e) {
      console.error('[triggerEndRound]', e);
    }
  },

  /* ==================== 游戏结束 ==================== */

  onGameFinished(players) {
    this.clearTimer();
    this.stopRoundWatcher();
    const arr = (players || []).map(p => ({
      openid: p.openid,
      nickName: p.nickName,
      score: p.score || 0
    }));
    arr.sort((a, b) => b.score - a.score);
    this.setData({ finalScores: arr, showGameOver: true });
  },

  /* ==================== 导航 ==================== */

  onShareAppMessage() {
    const { roomCode, roomId } = this.data;
    return {
      title: `来玩你画我猜，房间号 ${roomCode}`,
      path: `/pages/index/index?inviteRoomCode=${roomCode}&inviteRoomId=${roomId}`
    };
  },

  backToHome() { wx.navigateBack({ delta: 2 }); },
  playAgain() { this.backToHome(); },
});

// pages/game/game.js
const db = wx.cloud.database();
const _ = db.command;

function throttle(fn, delay) {
  let last = 0;
  return function () {
    const now = Date.now();
    if (now - last > delay) {
      last = now;
      fn.apply(this, arguments);
    }
  };
}

Page({
  /* ================= 数据 ================= */
  data: {
    roomId: '',
    roomCode: '',
    openid: '',
    loading: false,

    /* 房间级字段 */
    maxPlayers: 4,
    roundTime: 0,
    totalRounds: 0,
    timeLeft: 0,
    currentRound: 0,
    isOwner: false,
    gameStatus: 'waiting',   // waiting / playing / finished

    gameId: '',

    /* 回合级字段 */
    currentWord: '',
    currentDrawer: '',
    currentDrawerNickName: '',
    isDrawer: false,

    /* 画布 */
    canvasContext: null,
    selectedTool: 'pen',
    isDrawing: false,
    lastPoint: null,
    drawingBuffer: [],
    strokeThrottle: null,

    /* 玩家 & 聊天 */
    players: [],            // [{openid, nickName, score, isReady, ...}]
    messages: [],           // 与 rounds.guesses 同步
    chatInput: '',

    /* 结束页 */
    currentUserReady: false,
    showGameOver: false,
    finalScores: []
  },

  /* 拉一次 */
  async fetchRoomOnce() {
    const { result } = await wx.cloud.callFunction({
      name: 'getRoomInfo',
      data: { roomId: this.data.roomId }
    });
    if (result.success) {
      this.onRoomSnapshot({ docs: [result.room] }); // 直接复用同一个更新函数
    } else {
      wx.showToast({ title: result.errMsg, icon: 'none' });
    }
  },  

  /* ================= 生命周期 ================= */
  async onLoad(options) {
    const { roomCode, roomId } = options;
    if (!roomId) {
      wx.showToast({ title: '缺少房间ID', icon: 'none' });
      wx.navigateBack();
      return;
    }
  
    /* 1️⃣ 等登录态完成 */
    await getApp().getUserInfoReady();
  
    /* 2️⃣ 拿 openid */
    const { userInfo, openid } = getApp().globalData;
    if (!userInfo || !openid) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.navigateBack();
      return;
    }
    this.setData({ roomId, roomCode, openid, loading: true });
  
    /* 3️⃣ 初始化画布 */
    this.initCanvas();
  
    /* 4️⃣ 先拉一次房间信息 */
    await this.fetchRoomOnce();
    
    /* ✅ 4.5 玩家加入房间（关键！） */
    try {
      const { userInfo, openid } = getApp().globalData;
      await wx.cloud.callFunction({
        name: 'joinRoom',
        data: {
          roomId: this.data.roomId,
          openid,
          nickName: userInfo.nickName,
          avatarUrl: userInfo.avatarUrl
        }
      });
      console.log('✅ 已加入房间');
    } catch (e) {
      console.error('joinRoom 调用失败:', e);
    }
    
    /* 5️⃣ 再建立实时监听（此时已登录，绝不会报 -402002） */
    this.roomWatcher = db.collection('room').doc(roomId).watch({
      onChange: snapshot => {
        console.log('📡 room watch triggered', snapshot)
        this.onRoomSnapshot(snapshot)
      },
      // this.onRoomSnapshot.bind(this),
      onError: e => console.error('room watch', e)
    });
  },

  onUnload() {
    this.roomWatcher && this.roomWatcher.close();
    this.roundWatcher && this.roundWatcher.close();
    this.clearTimer();
  },

  /* ================= 实时数据 ================= */
  onRoomSnapshot(snapshot) {
    const doc = snapshot.docs[0];
    // console.log(doc);
    if (!doc) return;

    // 更新房间级数据
    this.setData({
      maxPlayers: doc.maxPlayers,
      roundTime: doc.roundTime,
      timeLeft: doc.roundTime,
      totalRounds: doc.totalRounds,
      gameStatus: doc.status,
      currentRound: doc.currentRoundIdx || 0,
      currentDrawer: doc.currentDrawer || '',
      currentWord: doc.word || '',
      players: doc.players || [],
    });
    const openid = this.data.openid;
    // console.log(openid);
    // 判断房主
    this.setData({ isOwner: doc.ownerOpenid === openid });
    // 判断自己是不是画手
    this.setData({ isDrawer: doc.currentDrawer === openid });
    // 当前绘画者信息
    const player = this.data.players.find(p => p.openid === doc.currentDrawer);
    const currentDrawerNickName = player ? player.nickName : '';
    this.setData({ currentDrawerNickName: currentDrawerNickName });
    // 监听当前回合
    this.refreshRoundWatcher(doc.currentRoundId);
    // 倒计时
    if (doc.status === 'playing' && !this.timer) {
      const left = Math.max(0, Math.floor((doc.endAt - Date.now()) / 1000));
      this.setData({ timeLeft: left });
      console.log('首次启动倒计时');
      this.startTimer(doc.endAt);
    } else if (doc.status === 'finished') {
      this.endGame(doc.totalScore);
    };
    this.drawAllStrokes(doc.strokes || []);

    console.log('room snapshot', snapshot.docs[0]);
    // console.log('data', this.data);
  },

  /* 根据 stroke 对象在 canvas 上画线（可被多端复用） */
  drawAllStrokes(strokes) {
    const ctx = this.data.canvasContext;
    if (!ctx || !strokes || !strokes.length) return;
  
    ctx.clearRect(0, 0, 300, 200);          // 先清屏
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

  refreshRoundWatcher(roundId) {
    if (this.roundWatcher) this.roundWatcher.close();
    if (!roundId) return;

    this.roundWatcher = db.collection('rounds').doc(roundId).watch({
      onChange: snap => {
        const round = snap.docs[0];
        if (round) {
          this.setData({ messages: round.guesses || [] });
        }
      },
      onError: e => console.error('round watch', e)
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
    if (tool === 'pen') {
      ctx.setStrokeStyle('#000000');
      ctx.setLineWidth(3);
    } else if (tool === 'eraser') {
      ctx.setStrokeStyle('#ffffff');
      ctx.setLineWidth(10);
    }
  },

  clearCanvas() {
    /* 本地立即清屏，体验顺滑 */
    const ctx = this.data.canvasContext;
    ctx.clearRect(0, 0, 300, 200);
    ctx.draw(true);
  
    /* 云端数据库也清空 strokes */
    wx.cloud.callFunction({
      name: 'clearStrokes',
      data: { roomId: this.data.roomId }
    });
  },

  /* ================= 绘图事件 ================= */
  /* =====  触摸开始  ===== */
  onTouchStart(e) {
    if (!this.data.isDrawer || this.data.gameStatus !== 'playing') return;

    const { x, y } = e.touches[0];
    this.setData({
      isDrawing: true,
      drawingBuffer: [{ x, y }]
    });
  },

  /* =====  触摸移动  ===== */
  onTouchMove(e) {
    if (!this.data.isDrawing) return;

    const { x, y } = e.touches[0];
    const ctx = this.data.canvasContext;

    /* 本地立即画出来，体验顺滑 */
    const last = this.data.drawingBuffer[this.data.drawingBuffer.length - 1];
    ctx.setStrokeStyle(this.data.selectedTool === 'pen' ? '#000000' : '#ffffff');
    ctx.setLineWidth(this.data.selectedTool === 'pen' ? 3 : 10);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.draw(true);

    /* 把点压进缓冲区 */
    this.data.drawingBuffer.push({ x, y });
  },

  /* =====  触摸结束  ===== */
  onTouchEnd() {
    if (!this.data.isDrawing) return;
    this.setData({ isDrawing: false });

    /* 一条笔画完成，推云端 */
    const stroke = {
      color: this.data.selectedTool === 'pen' ? '#000000' : '#ffffff',
      width: this.data.selectedTool === 'pen' ? 3 : 10,
      points: this.data.drawingBuffer
    };

    wx.cloud.callFunction({
      name: 'sendStroke',
      data: {
        roomId: this.data.roomId,
        stroke
      }
    });

    /* 清空缓冲区，准备下一条线 */
    this.setData({ drawingBuffer: [] });
  },

  /* ================= 聊天 ================= */
  onChatInput(e) {
    this.setData({ chatInput: e.detail.value });
  },

  async sendMessage() {
    const text = this.data.chatInput.trim();
    if (!text || this.data.isDrawer) return;

    wx.showLoading({ title: '发送中' });
    await wx.cloud.callFunction({
      name: 'sendGuess',
      data: { roomCode: this.data.roomCode, text }
    });
    wx.hideLoading();
    this.setData({ chatInput: '' });
  },

  /* ================= 房主开始游戏 ================= */
  async startGame() {
    wx.showLoading({ title: '准备中' });

    try {
      // 1) 创建 games 记录
      const createRes = await wx.cloud.callFunction({
        name: 'createGame',
        data: {
          roomId: this.data.roomId,
          roomCode: this.data.roomCode,
          players: this.data.players
        }
      });
      const gameId = createRes.result.gameId;
  
      // 2) 房间状态改为 playing
      const gameRes = await wx.cloud.callFunction({
        name: 'startGame',
        data: { roomId: this.data.roomId, gameId }
      });
      const { status } = gameRes.result;
      this.setData({
        gameStatus: status
      })
      console.log('gameStatus', this.data.gameStatus)
  
      // 3) 开始第 1 回合
      const startRoundRes = await wx.cloud.callFunction({
        name: 'startRound',
        data: {
          roomId: this.data.roomId,
          roundIdx: 1,
          drawer: this.data.players[0].openid   // 第 1 个玩家当画者
        }
      });
      const {roundIdx, word, drawer} = startRoundRes.result;
      // console.log('startRoundRes', roundIdx, word, drawer)
      const player = this.data.players.find(p => p.openid === drawer);
      // console.log('player', player);
      const currentDrawerNickName = player ? player.nickName : '';
      this.setData({
        currentWord: word,
        currentRound: roundIdx,
        currentDrawer: drawer,
        currentDrawerNickName: currentDrawerNickName,
        isDrawer: drawer === this.data.openid,
        timeLeft: this.data.roundTime,
      });
      // console.log(this.data);
  
      // 4) 本地保存 gameId，页面可以继续监听
      this.setData({ gameId });
      this.setData({ isDrawing: true});
      
      // 5) 手动再拉一次房间信息（确保立即拿到最新状态）
      await this.fetchRoomOnce();
      
      wx.hideLoading();
    } catch (e) {
      wx.hideLoading();
      console.error('startGame error:', e);
      wx.showToast({ title: e.errMsg || '开始失败', icon: 'none' });
    }
  },

  /* ================= 倒计时 ================= */
  startTimer(endAt) {
    console.log('startTimer timeLeft =', this.data.timeLeft);
    this.clearTimer();
    this.timer = setInterval(() => {
      const left = Math.max(0, Math.floor((endAt - Date.now()) / 1000));
      this.setData({ timeLeft: left });
      if (left <= 0) {
        this.clearTimer();
        // 后端自动 endRound，前端只做提示
        wx.showToast({ title: '时间到', icon: 'none' });
      }
    }, 1000);
  },

  clearTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },

  /* ================= 结束页 ================= */
  endGame(totalScore) {
    this.clearTimer();
    const player = this.data.players.find(p => p.openid === openid);
    const nickName = player ? player.nickName : '未知';
    const arr = Object.entries(totalScore).map(([openid, score]) => ({
      openid,
      nickName: nickName,
      score
    }));
    arr.sort((a, b) => b.score - a.score);
    this.setData({ finalScores: arr, showGameOver: true });
  },

  /* ================= 导航 ================= */
  backToHome() {
    wx.navigateBack({ delta: 2 });
  },

  playAgain() {
    // 直接回到首页再开房，或调用自定义云函数
    this.backToHome();
  },

  /* ================= 准备 ================= */
  async handleReady() {
    const openid = this.data.openid;
    console.log('openid-test', openid)
    const roomId = this.data.roomId;
  
    // 调用云函数把当前玩家置为 ready
    await wx.cloud.callFunction({
      name: 'setPlayerReady',
      data: { roomId, openid }
    });
    // 前端本地立即刷新
    this.setData({ currentUserReady: true });
    console.log(this.data.currentUserReady)
    // console.log(this.data.players)
  },
});
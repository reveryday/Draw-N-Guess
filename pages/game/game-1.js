// pages/game/game.js
Page({
  data: {
    // 初始化数据
    roomId: '', // 房间号
    maxPlayers: 0, // 最大玩家数量
    roundTime: 0, // 每轮时间
    totalRounds: 0, // 总轮数
    timeLeft: 0, // 剩余时间
    currentRound: 1, // 当前轮数
    currentWord: '',
    currentDrawer: '',
    isDrawer: false,
    gameStatus: 'waiting', // playing, waiting, finished
    
    // 画板相关参数
    selectedTool: 'pen',
    canvasContext: null,
    isDrawing: false,
    lastPoint: null,
    
    // 玩家列表
    players: [],
    
    chatInput: '',
    scrollToView: '',
    
    // 游戏结束
    showGameOver: false,
    finalScores: []
  },

  onLoad(options) {
    const app = getApp();
    const { roomId } = options;

    // 从全局变量中根据 roomId 获取房间参数
    const roomParams = app.globalData.rooms[roomId];  //room是一个在app.js中定义的全局变量
    if (roomParams) {
      this.setData({   //更新room参数
        roomId: roomId,
        maxPlayers: roomParams.maxPlayers,
        roundTime: roomParams.roundTime,
        totalRounds: roomParams.totalRounds,
        timeLeft: roomParams.roundTime,
      });room
    } else {
      console.error('房间参数未找到');
      // 实际场景中可能需要返回上一页或提示错误
      return;
    }

    // 初始化画布
    this.initCanvas();
    
    // 模拟获取进入房间后的玩家列表
    this.fetchPlayersInRoom(roomId);
  },

  // 模拟获取房间内的玩家信息
  fetchPlayersInRoom(roomId) {
    // 在实际应用中，这里应该是网络请求，向服务器发送roomId，获取玩家列表
    // 这里我们用模拟数据代替
    const mockPlayers = [
      { id: 1, name: 'wsw', score: 0, avatar: '/images/avatar1.png', isReady: false },
      { id: 2, name: '玩家B', score: 0, avatar: '/images/avatar2.png', isReady: false },
      { id: 3, name: '玩家C', score: 0, avatar: '/images/avatar3.png', isReady: false },
    ];

    this.setData({
      players: mockPlayers
    });
  },

  onUnload() {
    // 清理定时器
    if (this.timer) {
      clearInterval(this.timer)
    }
  },

  // 初始化画布
  initCanvas() {
    const context = wx.createCanvasContext('drawingCanvas', this)
    context.setLineCap('round')
    context.setLineJoin('round')
    context.setLineWidth(3)
    context.setStrokeStyle('#000000')
    this.setData({ canvasContext: context })
  },

  // 处理玩家准备
  handleReady() {
    // 假设当前用户是列表中的第一个玩家
    const currentPlayerId = 1;
    const players = this.data.players.map(p => {
      if (p.id === currentPlayerId) {
        return { ...p, isReady: true };
      }
      return p;
    });

    this.setData({ players });
    this.checkAllReady();
  },

  // 检查是否所有玩家都已准备
  checkAllReady() {
    const allReady = this.data.players.every(p => p.isReady);
    if (allReady && this.data.players.length > 0) {
      this.startGame();
    }
  },

  // 开始游戏
  startGame() {
    // 随机选择一个画家
    const players = this.data.players;
    const drawerIndex = Math.floor(Math.random() * players.length);
    const updatedPlayers = players.map((player, index) => ({
      ...player,
      isDrawer: index === drawerIndex,
      hasGuessed: false // 重置猜测状态
    }));

    const currentDrawer = updatedPlayers[drawerIndex];
    // 假设当前用户是id为1的玩家
    const isCurrentUserDrawer = currentDrawer.id === 1;

    this.setData({
      gameStatus: 'playing',
      players: updatedPlayers,
      currentDrawer: currentDrawer.name,
      isDrawer: isCurrentUserDrawer,
      currentWord: isCurrentUserDrawer ? '小猫' : '', // 实际应从词库获取
      currentRound: 1 // 开始第一轮
    });

    // 添加系统消息
    this.addMessage('system', `所有人都准备好了！第1轮开始，由 ${currentDrawer.name} 画画！`);
    
    // 开始计时器
    this.startTimer();
  },

  // 开始计时器
  startTimer() {
    this.timer = setInterval(() => {
      const timeLeft = this.data.timeLeft - 1
      this.setData({ timeLeft })
      
      if (timeLeft <= 0) {
        this.onRoundEnd()
      }
    }, 1000)
  },

  // 回合结束
  onRoundEnd() {
    clearInterval(this.timer)
    
    // 模拟下一轮或游戏结束
    if (this.data.currentRound >= this.data.totalRounds) {
      this.endGame()
    } else {
      this.nextRound()
    }
  },

  // 下一轮
  nextRound() {
    // 模拟切换画家和重置状态
    const players = this.data.players.map((player, index) => ({
      ...player,
      isDrawer: index === this.data.currentRound % this.data.players.length,
      hasGuessed: false
    }))
    
    this.setData({
      currentRound: this.data.currentRound + 1,
      timeLeft: this.data.roundTime,
      players,
      currentDrawer: players.find(p => p.isDrawer).name,
      isDrawer: players[0].isDrawer,
      currentWord: players[0].isDrawer ? '新题目' : ''
    })
    
    // 清空画布
    this.clearCanvas()
    
    // 添加系统消息
    this.addMessage('system', `第${this.data.currentRound}轮开始！${this.data.currentDrawer}开始画画`)
    
    // 重新开始计时
    this.startTimer()
  },

  // 结束游戏
  endGame() {
    const finalScores = this.data.players
      .sort((a, b) => b.score - a.score)
      .map(player => ({ id: player.id, name: player.name, score: player.score }))
    
    this.setData({
      showGameOver: true,
      finalScores
    })
  },

  // 画板工具选择
  selectTool(e) {
    const tool = e.currentTarget.dataset.tool
    this.setData({ selectedTool: tool })
    
    const context = this.data.canvasContext
    if (tool === 'pen') {
      context.setStrokeStyle('#000000')
      context.setLineWidth(3)
    } else if (tool === 'eraser') {
      context.setStrokeStyle('#ffffff')
      context.setLineWidth(10)
    }
  },

  // 清空画布
  clearCanvas() {
    const context = this.data.canvasContext
    context.clearRect(0, 0, 300, 200)
    context.draw()
  },

  // 触摸开始
  onTouchStart(e) {
    if (!this.data.isDrawer) return;

    const context = this.data.canvasContext;
    const touch = e.touches[0];
    const point = { x: touch.x, y: touch.y };

    // 开始一个新的路径，防止连接到上一次绘制的结束点
    context.beginPath();
    
    // 将画笔移动到触摸点
    context.moveTo(point.x, point.y);
    // 画一个半径为1.5的圆，来绘制一个点 (1.5是线宽3的一半)
    context.arc(point.x, point.y, 1.5, 0, 2 * Math.PI);
    // 设置填充颜色，使其与线条颜色一致
    context.setFillStyle('#000000');
    context.fill();
    context.draw(true);

    this.setData({
      isDrawing: true,
      lastPoint: point
    });
  },

  // 触摸移动
  onTouchMove(e) {
    if (!this.data.isDrawer || !this.data.isDrawing) return;

    const context = this.data.canvasContext;
    const touch = e.touches[0];
    const point = { x: touch.x, y: touch.y };
    const lastPoint = this.data.lastPoint;

    // 从上一个点画线到当前点
    context.moveTo(lastPoint.x, lastPoint.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    context.draw(true);

    this.setData({
      lastPoint: point
    });
  },

  // 触摸结束
  onTouchEnd() {
    this.setData({
      isDrawing: false,
      lastPoint: null // 清空上一个点
    });
  },

  // 聊天输入
  onChatInput(e) {
    this.setData({ chatInput: e.detail.value })
  },

  // 发送消息
  sendMessage() {
    const message = this.data.chatInput.trim()
    if (!message) return
    
    // 检查是否猜对
    const isCorrect = message === this.data.currentWord
    
    if (isCorrect) {
      this.addMessage('correct', '玩家1')
      // 更新玩家状态
      const players = this.data.players.map(player => 
        player.id === 1 ? { ...player, hasGuessed: true, score: player.score + 10 } : player
      )
      this.setData({ players })
    } else {
      this.addMessage('chat', '玩家1', message)
    }
    
    this.setData({ chatInput: '' })
  },

  // 添加消息
  addMessage(type, sender, content = '') {
    const newMessage = {
      id: Date.now(),
      type,
      sender,
      content
    }
    
    const messages = [...this.data.messages, newMessage]
    this.setData({ 
      messages,
      scrollToView: `msg-${messages.length - 1}`
    })
  },

  // 返回首页
  backToHome() {
    wx.navigateBack({
      delta: 2
    })
  },

  // 再来一局
  playAgain() {
    // 重置游戏状态
    this.setData({
      currentRound: 1,
      roundTime: 90,
      showGameOver: false,
      players: this.data.players.map((player, index) => ({
        ...player,
        score: 0,
        isDrawer: index === 0,
        hasGuessed: false
      })),
      messages: [{ id: Date.now(), type: 'system', content: '新游戏开始！' }]
    })
    
    this.clearCanvas()
    this.initGameData()
    this.startTimer()
  }
})
// pages/index/index.js
const app = getApp() 
const defaultAvatarUrl = 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0'

Page({
  data: {
    avatarUrl: defaultAvatarUrl, // 默认头像
    nickname: null,
    isLoggedIn: false,
    invitedRoomCode: '',
    invitedRoomId: ''
  },

  // ********* 头像 *********
  getAvatar(e) {
    const info = e.detail && (e.detail.userInfo || e.detail);
    if (info && info.avatarUrl) this.setData({ avatarUrl: info.avatarUrl });
  },
  // ********* 昵称 *********
  getNickName(e){
    this.setData({ nickname: e.detail.value });
  },

  // 显示加入房间弹窗
  joinRoom() {
    this.setData({
      showJoinModal: true,
      inputRoomId: '' // 清空输入框，设为空字符串
    })
  },

  // 房间号输入
  onRoomIdInput(e) {
    this.setData({
      inputRoomId: e.detail.value  //更新inputroomid
    })
  },

  // 隐藏加入房间弹窗
  hideJoinModal() {
    this.setData({
      showJoinModal: false,
      inputRoomId: ''
    })
  },

  // 防止 modal 内容区域点击冒泡到遮罩层
  stopPropagation() {
    // no-op
  },

  // 确认加入房间
  confirmJoinRoom() {
    const roomId = this.data.inputRoomId
    if (!roomId || roomId.length !== 6) {
      wx.showToast({
        title: '请输入6位房间号',
        icon: 'none'
      })
      return
    }
    
    // 检查用户登录状态
    const userInfo = getApp().globalData.userInfo;
    if (!userInfo) {
      wx.showToast({
        title: '请先登录',
        icon: 'none'
      })
      return
    }
    
    this.setData({ loading: true, loadingText: '正在加入房间...' })
    // 调用加入房间API
    this.joinRoomById(roomId)
  },

  onLoad(options = {}) {
    const invitedRoomCode = options.inviteRoomCode || '';
    const invitedRoomId = options.inviteRoomId || '';

    // 如果全局已有登录信息，直接显示
    if (getApp().globalData.userInfo) {
      this.setData({
        avatarUrl: getApp().globalData.userInfo.avatarUrl,
        nickname : getApp().globalData.userInfo.nickname,
        isLoggedIn: true,
        invitedRoomCode,
        invitedRoomId
      });
      if (invitedRoomCode) {
        this.joinRoomById(invitedRoomCode, invitedRoomId);
      }
      return;
    }

    this.setData({ invitedRoomCode, invitedRoomId });
  },

  // 创建房间
  intoCreate() {
    wx.navigateTo({
      url: '/pages/create/create'
    })
  },

  async saveUserInfo() {
    const { avatarUrl, nickname } = this.data;
    if (!nickname.trim()) return wx.showToast({ title: '请输入昵称', icon: 'none' });
  
    wx.showLoading({ title: '登录中' });
    try {
      // 1. 先看有没有注册过
      const { result: getRes } = await wx.cloud.callFunction({ name: 'user', data: { action: 'get' } });
      const exist = getRes.user;
  
      // 2. 根据情况调用 register 或 update
      const actionType = exist ? 'update' : 'register';
      const { result: saveRes } = await wx.cloud.callFunction({ name: 'user', data: { action: actionType, avatarUrl, nickname } });
  
      // 3. 更新全局 & 页面状态 & 本地缓存
      const openid = saveRes.openid;
      getApp().globalData.userInfo = { avatarUrl, nickname, _openid: openid };
      getApp().globalData.openid   = openid;
      wx.setStorageSync('userInfo', { avatarUrl, nickname, _openid: openid }); // 保存到本地缓存
      this.setData({ isLoggedIn: true });
      wx.showToast({ title: '登录成功' });

      if (this.data.invitedRoomCode) {
        this.joinRoomById(this.data.invitedRoomCode, this.data.invitedRoomId);
      }
    } catch (err) {
      console.error(err);
      wx.showToast({ title: '登录失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  // 通过短码加入房间（调用云函数 enterRoom）
  async joinRoomById(roomCode, invitedRoomId = '') {
    try {
      const userInfo = getApp().globalData.userInfo || {};
      // console.log(userInfo);
      const { result } = await wx.cloud.callFunction({
        name: 'enterRoom',
        data: { roomCode, nickName: userInfo.nickname, avatarUrl: userInfo.avatarUrl }
      });

      if (result && result.success) {
        this.setData({ showJoinModal: false, inputRoomId: '' });
        const roomId = result.roomId || invitedRoomId;
        this.setData({ invitedRoomCode: '', invitedRoomId: '' });
        wx.navigateTo({ url: `/pages/game/game?roomCode=${roomCode}&roomId=${roomId}` });
      } else {
        wx.showToast({ title: (result && result.errMsg) || '加入失败', icon: 'none' });
      }
    } catch (err) {
      console.error('joinRoomById error', err);
      wx.showToast({ title: '加入失败', icon: 'none' });
    } finally {
      this.setData({ loading: false, loadingText: '' });
      wx.hideLoading();
    }
  },

})

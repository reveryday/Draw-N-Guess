// app.js
App({
  globalData: {
    openid: '',
    userInfo: null,
    currentRoomCode: '',
    loginReady: false
  },

  onLaunch() {
    wx.cloud.init({ env: 'cloud1-7gf2xhiq4e745cfa' });
    this._loadUserInfoPromise = this._loadUserInfo(); // 保存 Promise
  },

  // 返回一个 Promise，确保调用方能等用户信息加载完
  getUserInfoReady() {
    return this._loadUserInfoPromise;
  },

  // 私有方法：恢复/获取登录态，返回 Promise
  _loadUserInfo() {
    return new Promise((resolve) => {
      const userInfo = wx.getStorageSync('userInfo');
      if (userInfo) {
        this.globalData.userInfo = userInfo;
        this.globalData.openid = userInfo._openid;
        resolve(userInfo);
        return;
      }

      wx.cloud.callFunction({
        name: 'user',
        data: { action: 'get' }
      }).then(res => {
        if (res.result.user) {
          const { user, openid } = res.result;
          // const user = res.result.user;
          this.globalData.userInfo = user;
          this.globalData.openid = openid;
          // console.log(openid);
          wx.setStorageSync('userInfo', { ...user, _openid: openid });
          resolve(user);
        } else {
          resolve(null); // 用户未注册
        }
      }).catch(err => {
        console.error(err);
        resolve(null);
      });
    });
    this.globalData.loginReady = true;
  }
});
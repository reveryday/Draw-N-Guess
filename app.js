// app.js
App({
  globalData: {
    openid: '',
    userInfo: null,
  },

  onLaunch() {
    wx.cloud.init({ env: 'cloud1-7gf2xhiq4e745cfa' });
    this._loadUserInfoPromise = this._loadUserInfo();
  },

  getUserInfoReady() {
    return this._loadUserInfoPromise;
  },

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
          this.globalData.userInfo = user;
          this.globalData.openid = openid;
          wx.setStorageSync('userInfo', { ...user, _openid: openid });
          resolve(user);
        } else {
          resolve(null);
        }
      }).catch(err => {
        console.error(err);
        resolve(null);
      });
    });
  }
});

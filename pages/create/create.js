// pages/create/create.js
const app = getApp()

function genRoomCode() {
  const chars = '0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

Page({
  data: {
    maxPlayers: 4,
    roundTime: 90,
    totalRounds: 5,
    loading: false,
  },

  async onLoad() {
    await app.getUserInfoReady();
  },

  changeMaxPlayers(e) {
    const action = e.currentTarget.dataset.action
    let maxPlayers = this.data.maxPlayers
    if (action === 'plus' && maxPlayers < 8) maxPlayers++
    else if (action === 'minus' && maxPlayers > 2) maxPlayers--
    this.setData({ maxPlayers })
  },

  setRoundTime(e) {
    this.setData({ roundTime: parseInt(e.currentTarget.dataset.time) })
  },

  changeRounds(e) {
    const action = e.currentTarget.dataset.action
    let totalRounds = this.data.totalRounds
    if (action === 'plus' && totalRounds < 10) totalRounds++
    else if (action === 'minus' && totalRounds > 3) totalRounds--
    this.setData({ totalRounds })
  },

  async intoRoom() {
    await app.getUserInfoReady();
    const { userInfo, openid } = app.globalData;

    if (!userInfo || !openid) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    try {
      const roomCode = genRoomCode();
      const { maxPlayers, roundTime, totalRounds } = this.data;

      const { result } = await wx.cloud.callFunction({
        name: 'createRoom',
        data: {
          action: 'create',
          roomCode,
          ownerOpenid: openid,
          nickName: userInfo.nickname,
          avatarUrl: userInfo.avatarUrl,
          maxPlayers,
          roundTime,
          totalRounds,
        }
      });

      if (result.success) {
        wx.navigateTo({ url: `/pages/game/game?roomCode=${roomCode}&roomId=${result.roomId}` });
      } else {
        wx.showToast({ title: '创建失败', icon: 'none' });
      }
    } catch (e) {
      console.error(e);
      wx.showToast({ title: '创建失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  }
})

// pages/create/create.js
const app = getApp()

// ******** 生成 6 位短码，作为roomCode *********
function genRoomCode() {
  // const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const chars = '0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

Page({
  data: {
    maxPlayers: 4, // 最大玩家数量
    roundTime: 90, // 每轮时间
    totalRounds: 5, // 总轮数
    selectedTopicTypes: [], // 题目类型
    loading: false,
  },

  async onLoad() {
    // 等用户信息
    await app.getUserInfoReady();
  },

    // 改变最大人数
    changeMaxPlayers(e) {
      const action = e.currentTarget.dataset.action
      let maxPlayers = this.data.maxPlayers
      
      if (action === 'plus' && maxPlayers < 8) {
        maxPlayers++
      } else if (action === 'minus' && maxPlayers > 2) {
        maxPlayers--
      }
      
      this.setData({ maxPlayers })
    },

    // 设置每轮时间
    setRoundTime(e) {
      const time = parseInt(e.currentTarget.dataset.time)
      this.setData({
        roundTime: time
      })
    },
    
    // 改变游戏轮数
    changeRounds(e) {
      const action = e.currentTarget.dataset.action
      let totalRounds = this.data.totalRounds
      
      if (action === 'plus' && totalRounds < 10) {
        totalRounds++
      } else if (action === 'minus' && totalRounds > 3) {
        totalRounds--
      }
      
      this.setData({ totalRounds })
    },

    // 切换题目类型
    toggleTopicType(e) {
      // 获取当前点击的选项类型
      const type = e.currentTarget.dataset.type;
      // 深拷贝当前已选中的话题类型数组
      let selectedTopicTypes = [...this.data.selectedTopicTypes];
      // 查找当前点击的类型是否已经在选中数组中
      const index = selectedTopicTypes.indexOf(type);
      // 如果已经选中，移除它
      if (index > -1) {
        selectedTopicTypes.splice(index, 1);
      } else {
        // 如果未选中，添加它
        selectedTopicTypes.push(type);
      }
      // 更新选中的话题类型数组
      this.setData({ selectedTopicTypes });
      // 调试输出
      console.log('当前选中的题目类型:', selectedTopicTypes);
      // 检查是否可以创建（可能基于选中的类型数量或其他条件）
      //this.checkCanCreate();
    },

  // 创建房间（写入房主）
  async intoRoom() {
    // 等用户信息加载完
    await app.getUserInfoReady();
    console.log('globalData:', app.globalData);
    const { userInfo, openid } = app.globalData;
    console.log(userInfo);
    console.log(openid);

    if (!userInfo || !openid) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
  
    this.setData({ loading: true });
    try {
      const roomCode   = genRoomCode();
      const { maxPlayers, roundTime, totalRounds, selectedTopicTypes } = this.data;
  
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
          topicTypes: selectedTopicTypes
        }
      });
  
      if (result.success) {
        wx.navigateTo({
          url: `/pages/game/game?roomCode=${roomCode}&roomId=${result.roomId}`
        });
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
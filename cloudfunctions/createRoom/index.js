// cloudfunctions/createRoom/index.js
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

exports.main = async (event) => {
  const {
    action,
    roomCode,
    ownerOpenid,
    maxPlayers,
    roundTime,
    totalRounds,
    topicTypes,
    nickName,      // 前端把昵称一起传过来
    avatarUrl      // 前端把头像一起传过来
  } = event;
  // const { OPENID } = cloud.getWXContext();

  if (action !== 'create') {
    return { success: false, errMsg: '未知 action' };
  }

  // 组装房主完整 player 对象
  const ownerPlayer = {
    openid: ownerOpenid,
    nickName: nickName || '神秘玩家',
    avatarUrl: avatarUrl || '/images/default-avatar.png',
    score: 0,
    isReady: false,
    hasGuessed: false
  };

  const res = await db.collection('room').add({
    data: {
      roomCode,
      ownerOpenid,
      maxPlayers,
      roundTime,
      totalRounds,
      topicTypes,
      status: 'waiting',
      players: [ownerPlayer],   // 直接放完整对象
      currentDrawer: '',
      currentRoundIdx: 0,
      word: '',
      createTime: new Date(),
      updateTime: new Date()
    }
  });

  return { success: true, roomCode, roomId: res._id };
};
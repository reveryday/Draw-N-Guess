// cloudfunctions/createRoom/index.js
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

exports.main = async (event) => {
  const { action, roomCode, ownerOpenid, maxPlayers, roundTime, totalRounds, nickName, avatarUrl } = event;
  const { OPENID } = cloud.getWXContext();

  if (action !== 'create') {
    return { success: false, errMsg: '未知 action' };
  }
  const finalOwnerOpenid = OPENID || ownerOpenid;
  if (!finalOwnerOpenid) {
    return { success: false, errMsg: '无法获取房主身份' };
  }

  const ownerPlayer = {
    openid: finalOwnerOpenid,
    nickName: nickName || '神秘玩家',
    avatarUrl: avatarUrl || '/images/default-avatar.png',
    score: 0,
    isReady: false,
    hasGuessed: false
  };

  const res = await db.collection('room').add({
    data: {
      roomCode,
      ownerOpenid: finalOwnerOpenid,
      maxPlayers,
      roundTime,
      totalRounds,
      status: 'waiting',
      players: [ownerPlayer],
      currentDrawer: '',
      currentRoundIdx: 0,
      currentRoundId: '',
      endAt: null,
      createTime: new Date(),
      updateTime: new Date()
    }
  });

  return { success: true, roomCode, roomId: res._id };
};

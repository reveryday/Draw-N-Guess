const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { roomCode, nickName, avatarUrl } = event || {};
  const { OPENID } = cloud.getWXContext();

  if (!roomCode) return { success: false, errMsg: '缺少 roomCode' };

  try {
    const roomRes = await db.collection('room').where({ roomCode }).limit(1).get();
    if (!roomRes.data || roomRes.data.length === 0) return { success: false, errMsg: '房间不存在' };

    const room = roomRes.data[0];
    const players = room.players || [];

    const alreadyIn = players.some(p => p && p.openid === OPENID);
    if (alreadyIn) return { success: true, alreadyIn: true, roomId: room._id };

    if (room.maxPlayers && players.length >= room.maxPlayers) return { success: false, errMsg: '房间已满' };

    const player = {
      openid: OPENID,
      nickName: nickName || '匿名玩家',
      avatarUrl: avatarUrl || '/images/default-avatar.png',
      score: 0,
      isReady: false,
      hasGuessed: false
    };

    await db.collection('room').doc(room._id).update({
      data: { players: _.push([player]), updateTime: db.serverDate() }
    });

    return { success: true, roomId: room._id };
  } catch (err) {
    console.error('enterRoom error:', err);
    return { success: false, errMsg: err.message || '加入失败' };
  }
};
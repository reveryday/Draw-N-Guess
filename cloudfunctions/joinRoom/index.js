// cloudfunctions/joinRoom/index.js
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { roomId, openid, nickName, avatarUrl } = event;
  if (!roomId || !openid) return { success: false, errMsg: '参数缺失' };

  try {
    const roomRef = db.collection('room').doc(roomId);
    const roomRes = await roomRef.get();
    const room = roomRes.data;
    if (!room) {
      return { success: false, errMsg: '房间不存在' };
    }

    const exists = room.players && room.players.some(p => p.openid === openid);
    if (exists) {
      console.log('玩家已存在，无需重复加入');
      return { success: true, msg: '已在房间中' };
    }

    await roomRef.update({
      data: {
        players: _.push([{
          openid,
          nickName,
          avatarUrl,
          isReady: false,
          score: 0
        }]),
        updatedAt: db.serverDate() // ⚡️ 必须
      }
    });

    console.log('✅ 玩家加入成功', openid);
    return { success: true };
  } catch (e) {
    console.error('❌ joinRoom error:', e);
    return { success: false, errMsg: e.message };
  }
};

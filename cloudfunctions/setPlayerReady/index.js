// cloudfunctions/setPlayerReady/index.js
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

exports.main = async (event) => {
  const { roomId, openid } = event;
  if (!roomId || !openid) {
    return { success: false, errMsg: '参数缺失' };
  }

  try {
    // 1. 先读出当前房间文档
    const roomRes = await db.collection('room').doc(roomId).get();
    const room = roomRes.data;
    if (!room) return { success: false, errMsg: '房间不存在' };

    // 2. 在 JS 中修改 players 数组
    const players = (room.players || []).map(p => ({
      ...p,
      isReady: p.openid === openid ? true : p.isReady
    }));

    // 3. 整体写回 + 用云端时间强制触发 watch
    const res = await db.collection('room').doc(roomId).update({
      data: {
        players,
        updatedAt: db.serverDate()
      }
    });

    return { success: true, res };
  } catch (e) {
    console.error('[setPlayerReady] error:', e);
    return { success: false, errMsg: e.message };
  }
};

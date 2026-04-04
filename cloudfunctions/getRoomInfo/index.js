const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

exports.main = async (event) => {
  const { roomId } = event;
  if (!roomId) {
    return { success: false, errMsg: '缺少 roomId' };
  }

  try {
    const res = await db.collection('room').doc(roomId).get();
    const room = res.data;
    if (!room) {
      return { success: false, errMsg: '房间不存在' };
    }

    // ✅ 返回完整字段，防止 undefined 导致前端逻辑异常
    return {
      success: true,
      room: {
        ...room,
        strokes: room.strokes || [],
        players: room.players || [],
        currentRoundId: room.currentRoundId || null,
        updatedAt: room.updatedAt || null
      }
    };
  } catch (e) {
    console.error('[getRoomInfo] error:', e);
    return { success: false, errMsg: e.message };
  }
};

// cloudfunctions/getCurrentRound/index.js
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

exports.main = async (event) => {
  const { roomId } = event;

  if (!roomId) {
    return { success: false, errMsg: '缺少 roomId' };
  }

  try {
    const roomRes = await db.collection('room').doc(roomId).get();
    const room = roomRes.data;
    if (!room) {
      return { success: false, errMsg: '房间不存在' };
    }

    let roundId = room.currentRoundId || '';
    let roundData = null;

    if (roundId) {
      try {
        const roundRes = await db.collection('rounds').doc(roundId).get();
        roundData = roundRes.data || null;
      } catch (e) {
        // room 上的 roundId 失效时，继续走最新回合兜底
      }
    }

    if (!roundData) {
      const latestRoundRes = await db.collection('rounds')
        .where({ roomId })
        .orderBy('roundIdx', 'desc')
        .limit(1)
        .get();
      if (!latestRoundRes.data || latestRoundRes.data.length === 0) {
        return { success: false, errMsg: '当前暂无回合' };
      }
      roundData = latestRoundRes.data[0];
      roundId = roundData._id;
    }

    return {
      success: true,
      roundId,
      currentDrawer: roundData.drawer || room.currentDrawer || '',
      currentWord: roundData.word || '',
      roundIdx: roundData.roundIdx || room.currentRoundIdx || 0,
      status: roundData.status || 'choosing'
    };
  } catch (e) {
    console.error('getCurrentRound error:', e);
    return {
      success: false,
      errMsg: e.message || '获取当前回合失败'
    };
  }
};

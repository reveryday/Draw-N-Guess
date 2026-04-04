// cloudfunctions/getCurrentRound/index.js
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

exports.main = async (event, context) => {
  const { roomId } = event;
  
  try {
    const room = await db.collection('room').doc(roomId).get();
    // const round = await db.collection('rounds').doc(room.data.currentRoundId).get();

    return {
      success: true,
      currentDrawer: round.data.drawer,
      currentWord: round.data.word,
      roundIdx: round.data.roundIdx
    };
  } catch (e) {
    console.error('getCurrentRound error:', e);
    return {
      success: false,
      errMsg: e.message || '获取当前回合失败'
    };
  }
};
// cloudfunctions/endGame/index.js
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

exports.main = async (event) => {
  const { roomId } = event;

  const gameRes = await db.collection('games').where({ roomId }).limit(1).get();
  if (!gameRes.data.length) return { success: false, errMsg: '未找到游戏记录' };

  const game = gameRes.data[0];
  const totalScore = game.totalScore || {};

  // 计算赢家
  let winner = null;
  let maxScore = -Infinity;
  Object.entries(totalScore).forEach(([openid, score]) => {
    if (score > maxScore) { maxScore = score; winner = openid; }
  });

  await db.collection('games').doc(game._id).update({
    data: { winner, finishTime: new Date() }
  });

  // 把 totalScore 写回 room，前端 onRoomSnapshot 可直接读取
  await db.collection('room').doc(roomId).update({
    data: {
      status: 'finished',
      totalScore,
      updateTime: new Date()
    }
  });

  return { success: true, winner, totalScore };
};

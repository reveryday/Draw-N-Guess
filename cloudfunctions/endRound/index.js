// cloudfunctions/endRound/index.js
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

exports.main = async (event) => {
  const { roundId, roomId, scores } = event;

  // 1. 更新本回合记录
  await db.collection('rounds').doc(roundId).update({
    data: {
      scores,
      endTime: new Date()
    }
  });

  // 2. 累加到 games.totalScore
  const gameRes = await db.collection('games').where({ roomId }).limit(1).get();
  if (!gameRes.data.length) {
    return { success: false, errMsg: '未找到对应的游戏记录' };
  }

  const game = gameRes.data[0];
  const totalScore = { ...(game.totalScore || {}) };

  for (const [player, score] of Object.entries(scores || {})) {
    totalScore[player] = (totalScore[player] || 0) + score;
  }

  await db.collection('games').doc(game._id).update({
    data: {
      totalScore,
      roundsCount: (game.roundsCount || 0) + 1,
      updateTime: new Date()
    }
  });

  return { success: true, totalScore };
};

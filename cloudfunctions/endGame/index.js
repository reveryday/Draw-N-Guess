// cloudfunctions/endGame/index.js
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

exports.main = async (event) => {
  const { roomId } = event;

  // 查找对应游戏记录
  const gameRes = await db.collection('games').where({ roomId }).limit(1).get();
  if (!gameRes.data.length) {
    return { success: false, errMsg: '未找到游戏记录' };
  }
  const game = gameRes.data[0];

  // 1. 计算赢家（根据 games.totalScore）
  const totalScore = game.totalScore || {};
  let winner = null;
  let maxScore = -Infinity;
  for (const [player, score] of Object.entries(totalScore)) {
    if (score > maxScore) {
      maxScore = score;
      winner = player;
    }
  }

  // 2. 更新游戏记录
  await db.collection('games').doc(game._id).update({
    data: {
      winner,
      finishTime: new Date()
    }
  });

  // 3. 更新房间状态
  await db.collection('room').doc(roomId).update({
    data: {
      status: 'finished',
      updateTime: new Date()
    }
  });

  return { success: true, winner, maxScore };
};

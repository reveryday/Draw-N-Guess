// cloudfunctions/startRound/index.js
// 开始一轮：创建回合记录，进入"画手出题"阶段
// 词由画手在前端输入后调用 submitWord 提交，此处不设词
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

exports.main = async (event) => {
  const { roomId, roundIdx, drawer } = event;

  // 创建回合记录，status: 'choosing' 表示等待画手出题
  const roundRes = await db.collection('rounds').add({
    data: {
      roomId,
      roundIdx,
      drawer,
      word: '',
      status: 'choosing',
      drawings: [],
      guesses: [],
      startTime: null,
      endTime: null,
      scores: {}
    }
  });

  const roundId = roundRes._id;

  // 更新房间：记录当前回合和画手，endAt 为 null（计时等画手出题后再启动）
  await db.collection('room').doc(roomId).update({
    data: {
      currentRoundId: roundId,
      currentDrawer: drawer,
      currentRoundIdx: roundIdx,
      endAt: null,
      updatedAt: db.serverDate()
    }
  });

  return { success: true, roundIdx, drawer, roundId };
};

const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();
const _ = db.command;  // ✅ 建议加上，后续用方便

// ✅ 词库
const WORDS = [
  '小猫', '小狗', '苹果', '香蕉', '大象', '飞机', '雨伞', '篮球',
  '冰淇淋', '长颈鹿', '太阳', '月亮', '火箭', '汉堡', '熊猫'
];
const randomWord = () => WORDS[Math.floor(Math.random() * WORDS.length)];

exports.main = async (event) => {
  const { roomId, roundIdx, drawer, word } = event;

  // ✅ 1. 生成单词
  let finalWord = word;
  if (!finalWord || !WORDS.includes(finalWord)) {
    finalWord = randomWord();
  }

  // ✅ 2. 创建新的 round 记录
  const roundRes = await db.collection('rounds').add({
    data: {
      roomId,
      roundIdx,
      drawer,
      word: finalWord,
      drawings: [],
      guesses: [],
      startTime: db.serverDate(),  // ✅ 改为云端时间
      endTime: null,
      usedHint: false,
      scores: {}
    }
  });

  // ✅ 3. 拿到 roundId 和 roundTime
  const roundId = roundRes._id;
  const roomDoc = await db.collection('room').doc(roomId).get();
  const roundTime = roomDoc.data.roundTime || 60;
  const endAt = Date.now() + roundTime * 1000;

  // ✅ 4. 更新 room 状态（关键！）
  await db.collection('room').doc(roomId).update({
    data: {
      currentRoundId: roundId,
      currentDrawer: drawer,
      currentRoundIdx: roundIdx,
      word: finalWord,
      endAt,
      updatedAt: db.serverDate()  // ⚡️⚡️ 必须用 serverDate()！
    }
  });

  return { success: true, roundIdx, word: finalWord, drawer, roundId };
};

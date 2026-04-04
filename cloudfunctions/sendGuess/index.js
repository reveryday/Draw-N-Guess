// cloudfunctions/sendGuess/index.js
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { roomCode, text } = event;
  const { OPENID } = cloud.getWXContext();

  const roomRes = await db.collection('room').where({ roomCode }).limit(1).get();
  if (!roomRes.data.length) return { success: false, errMsg: '房间不存在' };

  const room = roomRes.data[0];
  const roundRes = await db.collection('rounds')
    .where({ roomId: room._id })
    .orderBy('roundIdx', 'desc')
    .limit(1)
    .get();
  if (!roundRes.data.length) return { success: false, errMsg: '回合不存在' };

  const round = roundRes.data[0];
  const isCorrect = text === round.word;
  // 更新rounds中的猜测
  await db.collection('rounds').doc(round._id).update({
    data: { guesses: _.push({ openid: OPENID, text, isCorrect, timestamp: new Date() }) }
  });

  return { success: true, isCorrect };
};

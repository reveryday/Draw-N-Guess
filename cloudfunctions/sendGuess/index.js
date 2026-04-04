// cloudfunctions/sendGuess/index.js
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { roomCode, text } = event;
  const { OPENID } = cloud.getWXContext();

  if (!text || !text.trim()) return { success: false, errMsg: '内容不能为空' };

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

  if (round.status !== 'drawing') return { success: false, errMsg: '当前不是猜词阶段' };
  if (round.drawer === OPENID) return { success: false, errMsg: '画手不能猜词' };

  // 防止已猜中的玩家重复猜
  const alreadyCorrect = (round.guesses || []).some(g => g.openid === OPENID && g.isCorrect);
  if (alreadyCorrect) return { success: false, errMsg: '你已经猜对了' };

  const isCorrect = text.trim() === round.word;

  // 追加猜词记录
  await db.collection('rounds').doc(round._id).update({
    data: { guesses: _.push({ openid: OPENID, text: text.trim(), isCorrect, timestamp: new Date() }) }
  });

  // 猜中后更新 room.players 中对应玩家的 hasGuessed
  if (isCorrect) {
    const updatedPlayers = (room.players || []).map(p =>
      p.openid === OPENID ? { ...p, hasGuessed: true } : p
    );
    await db.collection('room').doc(room._id).update({
      data: { players: updatedPlayers, updatedAt: db.serverDate() }
    });
    console.log('[sendGuess] 猜中！openid=', OPENID);
  }

  return { success: true, isCorrect };
};

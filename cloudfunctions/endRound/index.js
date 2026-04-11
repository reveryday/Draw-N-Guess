// cloudfunctions/endRound/index.js
// 结束当前回合：结算分数 → 下一轮 or 结束整局
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

exports.main = async (event) => {
  const { roomId, roundId } = event;

  // 1. 获取回合和房间数据
  const [roundRes, roomRes] = await Promise.all([
    db.collection('rounds').doc(roundId).get(),
    db.collection('room').doc(roomId).get()
  ]);
  const round = roundRes.data;
  const room = roomRes.data;

  // 幂等：已结束则直接返回
  if (round.status === 'ended') {
    return { success: true, msg: '回合已结束' };
  }

  // 2. 结算本轮分数（猜中者 +10，画手每人 +5）
  const correctGuesses = (round.guesses || []).filter(g => g.isCorrect);
  const roundScores = {};
  const seen = new Set();
  correctGuesses.forEach(g => {
    if (!seen.has(g.openid)) {
      seen.add(g.openid);
      roundScores[g.openid] = 10;
    }
  });
  if (seen.size > 0) {
    roundScores[round.drawer] = (roundScores[round.drawer] || 0) + seen.size * 5;
  }

  // 3. 标记回合结束
  await db.collection('rounds').doc(roundId).update({
    data: { status: 'ended', endTime: db.serverDate(), scores: roundScores }
  });

  // 4. 累积分数到 room.players，重置 hasGuessed
  const updatedPlayers = (room.players || []).map(p => ({
    ...p,
    score: (p.score || 0) + (roundScores[p.openid] || 0),
    hasGuessed: false
  }));

  const currentRoundIdx = room.currentRoundIdx;
  const totalRounds = room.totalRounds;

  // 5. 判断是否结束整局
  if (currentRoundIdx >= totalRounds) {
    await db.collection('room').doc(roomId).update({
      data: {
        status: 'finished',
        players: updatedPlayers,
        endAt: null,
        updatedAt: db.serverDate()
      }
    });
    console.log('[endRound] 整局结束');
    return { success: true, action: 'game_end' };
  }

  // 6. 开始下一回合
  const nextRoundIdx = currentRoundIdx + 1;
  const nextDrawerIdx = currentRoundIdx % updatedPlayers.length;
  const nextDrawer = updatedPlayers[nextDrawerIdx].openid;

  const newRoundRes = await db.collection('rounds').add({
    data: {
      roomId,
      roundIdx: nextRoundIdx,
      drawer: nextDrawer,
      word: '',
      status: 'choosing',
      guesses: [],
      startTime: null,
      endTime: null,
      scores: {}
    }
  });

  await db.collection('room').doc(roomId).update({
    data: {
      currentRoundId: newRoundRes._id,
      currentDrawer: nextDrawer,
      currentRoundIdx: nextRoundIdx,
      endAt: null,
      strokes: [],
      players: updatedPlayers,
      updatedAt: db.serverDate()
    }
  });

  console.log('[endRound] 下一回合:', nextRoundIdx, '画手:', nextDrawer);
  return { success: true, action: 'next_round', nextRoundIdx, nextDrawer, roundId: newRoundRes._id };
};

// cloudfunctions/endRound/index.js
// 结束当前回合：结算分数 → 推进下一轮 or 结束整局
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

  // 2. 结算分数（猜中者+10，画手每人+5）
  const correctGuesses = (round.guesses || []).filter(g => g.isCorrect);
  const roundScores = {};
  const seen = new Set();
  correctGuesses.forEach(g => {
    if (!seen.has(g.openid)) {
      seen.add(g.openid);
      roundScores[g.openid] = (roundScores[g.openid] || 0) + 10;
    }
  });
  if (correctGuesses.length > 0) {
    roundScores[round.drawer] = (roundScores[round.drawer] || 0) + correctGuesses.length * 5;
  }

  // 3. 标记回合结束
  await db.collection('rounds').doc(roundId).update({
    data: { status: 'ended', endTime: db.serverDate(), scores: roundScores }
  });

  // 4. 累积到 games.totalScore
  const gameRes = await db.collection('games').where({ roomId }).limit(1).get();
  let totalScore = {};
  if (gameRes.data.length) {
    const game = gameRes.data[0];
    totalScore = { ...(game.totalScore || {}) };
    Object.entries(roundScores).forEach(([oid, s]) => {
      totalScore[oid] = (totalScore[oid] || 0) + s;
    });
    await db.collection('games').doc(game._id).update({
      data: { totalScore, roundsCount: (game.roundsCount || 0) + 1, updateTime: new Date() }
    });
  }

  // 5. 更新 room.players 分数，重置 hasGuessed
  const updatedPlayers = (room.players || []).map(p => ({
    ...p,
    score: totalScore[p.openid] !== undefined ? totalScore[p.openid] : (p.score || 0),
    hasGuessed: false
  }));

  const currentRoundIdx = room.currentRoundIdx;
  const totalRounds = room.totalRounds;

  // 6. 判断是否结束整局
  if (currentRoundIdx >= totalRounds) {
    await db.collection('room').doc(roomId).update({
      data: {
        status: 'finished',
        players: updatedPlayers,
        totalScore,   // 写回 room 供前端 onRoomSnapshot 直接读取
        endAt: null,
        updatedAt: db.serverDate()
      }
    });
    console.log('[endRound] 整局结束，totalScore:', totalScore);
    return { success: true, action: 'game_end', totalScore };
  }

  // 7. 开始下一回合
  const nextRoundIdx = currentRoundIdx + 1;
  // 轮流画手：按 players 顺序循环（跳过第0轮占位，从第1轮开始索引正确）
  const nextDrawerIdx = (currentRoundIdx) % updatedPlayers.length;
  const nextDrawer = updatedPlayers[nextDrawerIdx].openid;

  const newRoundRes = await db.collection('rounds').add({
    data: {
      roomId,
      roundIdx: nextRoundIdx,
      drawer: nextDrawer,
      word: '',
      status: 'choosing',
      drawings: [],
      guesses: [],
      startTime: null,
      endTime: null,
      scores: {}
    }
  });
  const newRoundId = newRoundRes._id;

  await db.collection('room').doc(roomId).update({
    data: {
      currentRoundId: newRoundId,
      currentDrawer: nextDrawer,
      currentRoundIdx: nextRoundIdx,
      endAt: null,
      strokes: [],       // 清空画板
      players: updatedPlayers,
      updatedAt: db.serverDate()
    }
  });

  console.log('[endRound] 下一回合:', nextRoundIdx, '画手:', nextDrawer);
  return { success: true, action: 'next_round', nextRoundIdx, nextDrawer, roundId: newRoundId };
};

// cloudfunctions/submitWord/index.js
// 画手提交本轮词条，切换至绘画阶段并启动倒计时
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

exports.main = async (event) => {
  const { roomId, roundId, word } = event;
  const { OPENID } = cloud.getWXContext();

  const trimmedWord = String(word || '').trim();
  if (!trimmedWord) return { success: false, errMsg: '词条不能为空' };

  const roomDoc = await db.collection('room').doc(roomId).get();
  const room = roomDoc.data;
  let targetRoundId = roundId || room.currentRoundId || '';

  // 兜底：room.currentRoundId 还没同步时，取该房间最新回合作为目标回合
  if (!targetRoundId) {
    const latestRoundRes = await db.collection('rounds')
      .where({ roomId })
      .orderBy('roundIdx', 'desc')
      .limit(1)
      .get();
    if (latestRoundRes.data && latestRoundRes.data.length > 0) {
      targetRoundId = latestRoundRes.data[0]._id;
    }
  }
  if (!targetRoundId) return { success: false, errMsg: '当前回合未初始化，请稍后重试' };

  // 以 room.currentDrawer 为主，回合 drawer 为辅做权限校验
  let roundDrawer = '';
  try {
    const roundDoc = await db.collection('rounds').doc(targetRoundId).get();
    roundDrawer = (roundDoc.data && roundDoc.data.drawer) || '';
  } catch (e) {
    console.warn('[submitWord] 读取 round 失败，继续按 room.currentDrawer 校验:', e.message);
  }
  if (room.currentDrawer !== OPENID && roundDrawer !== OPENID) {
    return { success: false, errMsg: '只有当前画手才能出题' };
  }

  const roundTime = room.roundTime || 60;
  const endAt = Date.now() + roundTime * 1000;

  // 更新回合：写词、进入 drawing 状态
  await db.collection('rounds').doc(targetRoundId).update({
    data: { word: trimmedWord, status: 'drawing', startTime: db.serverDate() }
  });

  // 更新房间：设置 endAt 触发所有客户端倒计时
  // 注意：不把词写入 room，保持对猜手不可见
  await db.collection('room').doc(roomId).update({
    data: { endAt, updatedAt: db.serverDate() }
  });

  console.log('[submitWord] 词条提交成功:', trimmedWord, 'endAt:', endAt, 'roundId:', targetRoundId);
  return { success: true, endAt, roundId: targetRoundId };
};

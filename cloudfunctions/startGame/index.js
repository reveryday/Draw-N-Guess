// cloudfunctions/startGame/index.js
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { roomId } = event;
  const { OPENID } = cloud.getWXContext();

  if (!roomId) return { success: false, errMsg: '缺少 roomId' };

  const roomRes = await db.collection('room').doc(roomId).get();
  const room = roomRes.data;
  if (!room) return { success: false, errMsg: '房间不存在' };
  if (room.status !== 'waiting') return { success: false, errMsg: '房间已开始或已结束' };
  if (room.ownerOpenid !== OPENID) return { success: false, errMsg: '只有房主可以开始游戏' };

  // 至少1名非房主玩家，且全部已准备
  const nonHostPlayers = (room.players || []).filter(p => p.openid !== room.ownerOpenid);
  if (nonHostPlayers.length === 0) {
    return { success: false, errMsg: '至少需要1名其他玩家才能开始' };
  }
  if (!nonHostPlayers.every(p => p.isReady)) {
    return { success: false, errMsg: '还有玩家未准备' };
  }

  await db.collection('room').doc(roomId).update({
    data: {
      status: 'playing',
      currentRoundIdx: 0,
      strokes: [],
      endAt: null,
      updatedAt: db.serverDate()
    }
  });

  console.log('[startGame] 游戏开始 roomId=', roomId, 'by', OPENID);
  return { success: true, status: 'playing' };
};

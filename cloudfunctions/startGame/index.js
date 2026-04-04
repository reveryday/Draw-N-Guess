// cloudfunctions/startGame/index.js
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { roomId } = event;
  const { OPENID } = cloud.getWXContext();

  if (!roomId) {
    return { success: false, errMsg: '缺少 roomId' };
  }

  try {
    // 1️⃣ 查房间
    const roomRes = await db.collection('room').doc(roomId).get();
    const room = roomRes.data;
    if (!room) {
      return { success: false, errMsg: '房间不存在' };
    }

    // 2️⃣ 状态检查
    if (room.status !== 'waiting') {
      return { success: false, errMsg: '房间已开始或已结束' };
    }

    // 3️⃣ 权限检查
    if (room.ownerOpenid !== OPENID) {
      return { success: false, errMsg: '只有房主可以开始游戏' };
    }

    // 4️⃣ 更新房间状态（⚡️使用 serverDate() 强制触发 watch）
    await db.collection('room').doc(roomId).update({
      data: {
        status: 'playing',
        currentRoundIdx: 1,
        // 清空上一轮笔画（防止残留）
        strokes: [],
        // 所有玩家准备状态重置
        players: _.map(item => ({
          ...item,
          isReady: false
        })),
        updatedAt: db.serverDate() // ✅ 关键
      }
    });

    // 5️⃣ 返回结果（前端根据 status=playing 进入游戏逻辑）
    return { success: true, msg: '游戏开始', status: 'playing' };
  } catch (err) {
    console.error('[startGame] error:', err);
    return { success: false, errMsg: err.message };
  }
};

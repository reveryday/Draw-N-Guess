// cloudfunctions/setPlayerReady/index.js
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { roomId, openid } = event;
  if (!roomId || !openid) {
    return { success: false, errMsg: '参数缺失' };
  }

  try {
    // ✅ 更新玩家准备状态 + 用云端时间强制触发 watch
    const res = await db.collection('room').doc(roomId).update({
      data: {
        players: _.map(item => ({
          ...item,
          isReady: item.openid === openid ? true : item.isReady
        })),
        updatedAt: db.serverDate()   // ⚡ 必须用这个，watch 才能触发
      }
    });

    return { success: true, res };
  } catch (e) {
    console.error('[setPlayerReady] error:', e);
    return { success: false, errMsg: e.message };
  }
};

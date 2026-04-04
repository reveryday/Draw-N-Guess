// cloudfunctions/user/index.js
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

exports.main = async (event) => {
  const { action, avatarUrl, nickname } = event;
  const { OPENID } = cloud.getWXContext();

  switch (action) {
    case 'get': {
      try {
        const res = await db.collection('users').doc(OPENID).get();
        return { success: true, user: res.data, openid: OPENID };
      } catch (e) {
        // 文档不存在返回 null，前端自己判断
        return { success: true, user: null };
      }
    }

    case 'register':
      await db.collection('users').doc(OPENID).set({
        data: {
          avatarUrl,
          nickname,
          totalGames: 0,
          winGames: 0,
          createTime: new Date(),
          updateTime: new Date(),
          isGaming: false
        }
      });
      return { success: true, openid: OPENID };

    case 'update':
      await db.collection('users').doc(OPENID).update({
        data: { avatarUrl, nickname, updateTime: new Date() }
      });
      return { success: true, openid: OPENID };

    default:
      return { success: false, errMsg: '未知 action' };
  }
};
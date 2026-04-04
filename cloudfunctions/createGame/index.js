// cloudfunctions/createGame/index.js
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

exports.main = async (event) => {
  const { roomId, roomCode, players } = event;

  const res = await db.collection('games').add({
    data: {
      roomId,
      roomCode,
      players,
      winner: '',
      roundsCount: 0,
      totalScore: {},
      createTime: new Date(),
      finishTime: null
    }
  });

  return { success: true, gameId: res._id };
};

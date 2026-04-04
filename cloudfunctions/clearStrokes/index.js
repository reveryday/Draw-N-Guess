// cloudfunctions/clearStrokes/index.js
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

exports.main = async (event) => {
  const { roomId } = event
  const db = cloud.database()
  await db.collection('room').doc(roomId).update({
    data: { strokes: [] }
  })
  return { ok: true }
}
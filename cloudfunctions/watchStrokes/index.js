// cloudfunctions/watchStrokes/index.js
const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

exports.main = async (event) => {
  const { roomId } = event
  const db = cloud.database()
  const res = await db.collection('room').doc(roomId).get()
  return { strokes: (res.data && res.data.strokes) || [] }
}
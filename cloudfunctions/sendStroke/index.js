const cloud = require('wx-server-sdk')
cloud.init()
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const { roomId, stroke } = event // stroke = {color, width, points:[{x,y}...]}

  await db.collection('room').doc(roomId).update({
    data: {
      // ✅ 数组追加，必须是 push([stroke])
      strokes: _.push([stroke]),

      // ✅ 关键：用服务器时间强制 watch 触发
      updatedAt: db.serverDate()
    }
  })

  return { ok: true }
}

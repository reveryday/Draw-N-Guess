# 你画我猜 - 微信小程序

多人在线你画我猜游戏，基于微信云开发。

## 技术栈

- **前端**: 微信小程序原生框架 (WXML / WXSS / JavaScript)
- **后端**: 微信云函数 (Node.js + wx-server-sdk)
- **数据库**: 微信云数据库
- **实时同步**: 云数据库 watch API + 轮询兜底

## 项目结构

```
├── app.js                     # 全局初始化、用户登录态
├── app.json                   # 页面路由配置
├── app.wxss                   # 全局样式
├── pages/
│   ├── index/                 # 首页：登录 + 创建/加入房间
│   ├── create/                # 创建房间：设置游戏参数
│   └── game/                  # 游戏主页：等待、画画、猜词、结算
└── cloudfunctions/
    ├── user/                  # 用户注册/登录/更新
    ├── createRoom/            # 创建房间
    ├── enterRoom/             # 加入房间（通过6位房间号）
    ├── getRoomInfo/           # 获取房间完整信息（轮询用）
    ├── setPlayerReady/        # 玩家点击准备
    ├── startGame/             # 房主开始游戏
    ├── startRound/            # 开始一个回合（指定画手）
    ├── submitWord/            # 画手提交词条（启动倒计时）
    ├── sendStroke/            # 发送画笔笔画
    ├── clearStrokes/          # 清空画布
    ├── sendGuess/             # 猜手发送猜测（自动判定对错）
    └── endRound/              # 结束回合：计分 → 下一轮 or 游戏结束
```

## 游戏流程

```
1. 登录
   └─ 选择头像 + 输入昵称 → 注册/更新用户信息

2. 创建或加入房间
   ├─ 创建房间：设置人数上限(2-8)、每轮时间(60/90/120s)、总轮数(3-10)
   └─ 加入房间：输入6位房间号

3. 等待大厅 (room.status = 'waiting')
   ├─ 非房主：点击"准备"
   └─ 房主：等所有人准备后，点击"开始游戏"

4. 游戏进行 (room.status = 'playing')
   每轮流程：
   ├─ 出题阶段 (round.status = 'choosing')
   │   └─ 画手在弹窗中输入本轮词条
   ├─ 画画阶段 (round.status = 'drawing')
   │   ├─ 画手在画布上作画，笔画实时同步
   │   ├─ 猜手输入猜测，猜对 +10 分
   │   └─ 画手每有一人猜对 +5 分
   │   └─ 倒计时结束 → 房主端触发 endRound
   └─ 回合结束
       ├─ 未到总轮数 → 轮换画手，开始新一轮
       └─ 已到总轮数 → 游戏结束

5. 游戏结束 (room.status = 'finished')
   └─ 弹窗显示最终排名和分数
```

## 数据库集合

### users

| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 用户 openid |
| nickname | string | 昵称 |
| avatarUrl | string | 头像地址 |
| totalGames | number | 总局数 |
| winGames | number | 胜场数 |

### room

| 字段 | 类型 | 说明 |
|------|------|------|
| roomCode | string | 6 位房间号 |
| ownerOpenid | string | 房主 openid |
| status | string | `waiting` / `playing` / `finished` |
| players | array | `[{openid, nickName, avatarUrl, score, isReady, hasGuessed}]` |
| maxPlayers | number | 最大人数 |
| roundTime | number | 每轮时长（秒） |
| totalRounds | number | 总轮数 |
| currentDrawer | string | 当前画手 openid |
| currentRoundIdx | number | 当前轮次（从 1 开始） |
| currentRoundId | string | 当前回合文档 `_id` |
| strokes | array | 画笔数据 `[{color, width, points:[{x,y}]}]` |
| endAt | number | 本轮倒计时结束时间戳 |
| updatedAt | serverDate | 最后更新时间（触发 watch 的关键字段） |

### rounds

| 字段 | 类型 | 说明 |
|------|------|------|
| roomId | string | 所属房间 `_id` |
| roundIdx | number | 轮次序号 |
| drawer | string | 画手 openid |
| word | string | 本轮词条（仅画手可见） |
| status | string | `choosing` / `drawing` / `ended` |
| guesses | array | `[{openid, text, isCorrect, timestamp}]` |
| scores | object | 本轮得分 `{openid: number}` |

## 实时同步机制

采用 **watcher + 轮询** 双保险：

1. **主通道** — `db.collection('room').doc(roomId).watch()` 监听房间文档变化
2. **兜底** — 每 3 秒通过云函数 `getRoomInfo` 主动拉取一次

### 重要：数据库安全规则

在 **微信云开发控制台** 中，将 `room` 和 `rounds` 集合的安全规则设为：

```json
{
  "read": true,
  "write": true
}
```

默认规则 `"auth.openid == doc._openid"` 只允许文档创建者读取，
会导致非房主玩家的 watcher 无法收到推送。

## 部署步骤

1. 微信开发者工具导入项目
2. 开通云开发环境
3. 创建数据库集合：`users`、`room`、`rounds`
4. **设置集合安全规则**（见上方）
5. 右键逐个上传 `cloudfunctions/` 下的所有云函数（云端安装依赖）
6. 编译运行

## 计分规则

- 猜中的玩家：+10 分
- 画手：每有 1 人猜中 +5 分
- 全部回合结束后按总分排名

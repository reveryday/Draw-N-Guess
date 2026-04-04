# 自定义词你画我猜问题说明

## 范围

本文只聚焦当前仓库“自定义词你画我猜”的 `game` 页联调问题，尤其是你最新反馈的房主端异常。

涉及主链路：

- `pages/game`
- `cloudfunctions/enterRoom`
- `cloudfunctions/createRoom`
- `cloudfunctions/startGame`
- `cloudfunctions/startRound`
- `cloudfunctions/submitWord`
- `cloudfunctions/endRound`
- `cloudfunctions/endGame`

## 本轮实测结论

你最新反馈的两个问题已经是当前最高优先级：

1. 房主页面没有“开始游戏”按钮。
2. 房主页面不显示玩家头像。

这两个现象说明房主端等待区渲染链路有断点，不是单个按钮样式问题。

## 主要问题

### P0: 房主端“开始游戏”按钮不出现

实测现象：

- 房主进入房间后看不到“开始游戏”按钮。

代码证据：

- [`pages/game/game.wxml:15`](D:\Projects\Draw N Guess\pages\game\game.wxml:15) 等待区整体依赖 `gameStatus === 'waiting'`。
- [`pages/game/game.wxml:34`](D:\Projects\Draw N Guess\pages\game\game.wxml:34) 按钮区先判断 `!isOwner`，只有 `wx:else` 才显示开始按钮。
- [`pages/game/game.js:112`](D:\Projects\Draw N Guess\pages\game\game.js:112) `isOwner` 完全由 `doc.ownerOpenid === openid` 计算。

结论：

- 只要 `gameStatus` 或 `isOwner` 任一值异常，房主按钮就会消失。

### P0: 房主端玩家头像列表不显示

实测现象：

- 房主端看不到用户头像，无法确认成员状态。

代码证据：

- [`pages/game/game.wxml:16`](D:\Projects\Draw N Guess\pages\game\game.wxml:16) 等待区头像列表依赖 `players`。
- [`pages/game/game.wxml:103`](D:\Projects\Draw N Guess\pages\game\game.wxml:103) 进行中头像列表也依赖 `players`。
- [`pages/game/game.js:111`](D:\Projects\Draw N Guess\pages\game\game.js:111) `players` 只在 `onRoomSnapshot` 中赋值。
- [`pages/game/game.js:71`](D:\Projects\Draw N Guess\pages\game\game.js:71) 当前依赖 watcher 推送，没有显式兜底拉取。

结论：

- 房间快照同步不稳定时，`players` 为空会同时导致头像缺失和房主 UI 异常。

### P0: 房主身份识别与等待区渲染强耦合，缺少兜底

现状：

- 等待区显示、房主按钮显示、准备按钮显示都依赖 `isOwner` 与 `gameStatus`。
- 这两个值都来自同一条实时快照链路。

影响：

- 一次快照异常会造成“既看不到按钮，也看不到头像”的连锁表现。

### P1: 画手输入词条界面仍有同步窗口

现状：

- 词条输入区显示条件是 `roundStatus === 'choosing' && isDrawer`。
  - [`pages/game/game.wxml:51`](D:\Projects\Draw N Guess\pages\game\game.wxml:51)
- `roundStatus` 依赖 round watcher 更新。
  - [`pages/game/game.js:176`](D:\Projects\Draw N Guess\pages\game\game.js:176)

影响：

- 当回合状态切换与 UI 渲染不同步时，会出现“应该出词但输入区不出现”。

### P1: 回合结束与整局结束仍未闭环

现状：

- 倒计时结束后前端触发 `endRound`，但后端仍未形成稳定“结算并推进下一轮”链路。
  - [`pages/game/game.js:385`](D:\Projects\Draw N Guess\pages\game\game.js:385)
  - [`cloudfunctions/endRound/index.js`](D:\Projects\Draw N Guess\cloudfunctions\endRound\index.js)

影响：

- 主流程可启动但不能稳定跑完整局。

## 已确认的方向

以下方向在代码中已经体现，应继续保持：

1. 房主不参与“点击准备”。
   - [`pages/game/game.js:438`](D:\Projects\Draw N Guess\pages\game\game.js:438)
2. 每轮由画手现场输入词条。
   - [`pages/game/game.wxml:51`](D:\Projects\Draw N Guess\pages\game\game.wxml:51)
3. 房间密码功能不再进入范围。

## 当前执行优先级

1. 先修房主端等待区渲染链路，保证“开始按钮 + 玩家头像”稳定可见。
2. 再修 `players/isOwner/gameStatus` 的同步兜底策略。
3. 再修画手词条输入区显示稳定性。
4. 最后补回合闭环与结算推进。

# 任务页 v4.9 设计稿（子代理）—— 顶部运行条 × 会话内单行化 × 子代理页

> 状态：设计提案 v4.9（2026-10-13）。**仅设计稿，未动代码**；替代当前 SubtaskBlock「会话内嵌卡片疯狂累加」的形态。
> 可视原型：`design/task-page-subagent-mockup.html`（浏览器直接打开；三个视图可切、行可展开、深/浅双主题）。
> 前置约束：本稿只改会话流与新增子代理页；页签结构、改动页、检查点页、composer、授权浮层、任务清单卡片均沿用 v4.7/v4.8 不变。

## 一、当前问题（用户反馈原话）

> "优化子 agent 的显示，当前是在会话页面新增一个卡片，然后疯狂的累加，没法看"

**根因**（`TaskTimeline.tsx:580 SubtaskBlock`）：

1. `subtask` 事件按 `subtaskId` 在会话流里插一个卡片，卡片默认 `open={state==='running'}`——运行中直接摊开；
2. 卡片的展开体 `b.children` 是子代理**自己的整条会话流**（子代理内部每个 tool/thinking/assistant 事件都归到该卡片里）；子代理一跑就是几十上百行；
3. 主代理并发跑 3 个子代理（`settings.agents.maxSubagents=3`），一屏挤三张展开卡片，每张又叠子代理内部的思考+工具+结果，视觉上是「卡片里塞了另一个任务页」；
4. 结束后 `open=false` 但卡片仍在流里占一行——多个子代理并列挂在同一回合下，用户没法一眼看到"这次到底并行跑了哪些"；
5. 授权浮层的 `subtaskId` 冒泡标（`agent.permission.raised.subtaskId`）在子卡片里出现，但用户看不到子代理自己的完整上下文，只能猜。

## 二、修订总览（v4.7 → v4.9）

| 面 | v4.7/v4.8（现状） | v4.9 |
|---|---|---|
| 会话内子代理呈现 | 每张子代理 = 一张可展开卡片，默认展开（running 时），展开态 = 子代理完整时间线内嵌 | 每张子代理 = **一行动作行**（沿用 v4.7 命令执行动作行样式），默认折叠；点击行**跳转**到子代理页详情，不在会话流里展开 |
| 会话内并行状态 | 每张卡片右上角一个耗时数字，无汇总 | **顶部新增子代理运行条**（页签行下方、时间线上方）：`⚡ 子代理 2/3 运行中 · <当前主代理> 12s · <子代理> 8s · …`；点击进入子代理页 |
| 子代理详情入口 | 无（子代理内容全部挤在卡片展开体） | 会话行右缘「查看详情 →」，页头运行条 hover「查看 →」；键盘 ← 从详情页返回列表 |
| 子代理详情页 | 无 | 新增**页签**：子代理列表 → 详情对话（对话样式与会话页完全一致，顶部 ← 返回列表） |
| 事件通道 | `subtask` 事件（subtaskId 归组）+ 事件冒泡到主代理 journal | 不变；子代理持久化 `.git/gitter/agent-sessions/<taskId>/subtasks/<subtaskId>.json`（已有，含 messages） |
| 授权浮层 | 挂在会话页 composer 上方 | 不变（子代理详情不重复实现，跳转回会话页承接） |

## 三、会话页顶部子代理运行条

**位置**：`.tk-pagehead` 下方、`.tl-scroll` 上方，`gridRow: 1.5`（新增）；仅当 `runningSubs > 0 || queuedSubs > 0` 时出现（0 时完全消失，不占布局）。

**结构**（沿用 v4.7 单色流公理，不加框、不加背景）：

```
◐ 子代理 2/3   ▸ review   检索安全网…  8.2s   ← 展开详情  ·   ▸ act   实现 X…  3.1s   ← 展开详情  ·  +1 排队
```

- **左簇**：`◐ 子代理 2/3`（14.5px，`--c-text2`；2=running、3=maxSubagents；无运行/排队时整条隐藏）
- **中簇**：每个运行中子代理一枚 4px 圆点（`--c-amber`，`@keyframes v47-blink` 1s 闪烁）+ 名字（12px，`--c-text`，max-width 240px 省略）+ 耗时（11.5px，`--c-text3`，mono，`tabular-nums`）；排队子代理 = 空心圆点 + 名字 + "排队"
- **右簇**：`+N 排队`（仅 queued > 0 时出现，`--c-text3`）
- **整行高度** 22px，`padding: 0 8px`，`margin: 4px 0 8px`，`cursor: default`；每枚圆点行内可点击（`cursor: pointer`，hover `--c-text2` + 背景 `--c-hover`），点击跳子代理页详情
- **hover 一体化**：圆点 + 名字 + 耗时是同一个 hover 单元（对齐 v4.7「执行过程」的 hover 一体化）
- **不出现**：边框、阴影、`panel` 底色、按钮外框——纯文本行，视觉重量低于回合折叠行

**为什么放页头不放时间线内**：时间线内每条子代理行本来就在原位，页头是「并行总览」——用户切开会话页一眼看到"现在有几个在跑、谁排着队"，不需要滚动到时间线找。

## 四、会话流内子代理行

**替换 SubtaskBlock**（`TaskTimeline.tsx:580`），单行化：

```
◐ 子代理 · 检索安全网对 stash.apply 的确认策略 · 12.4s · ← 查看详情
```

**规范**：

- 高度 22px，`padding: 2px 8px`，与 `.tl-turn` 同轨（28px 左轨）
- **左轨图标**：`◐`（子代理专属符号，16px；`v47-blink` 闪烁仅运行中；结束态 `·`（静态灰点）；failed/timeout = `·` 红色）
- **正文**（`x=28`）：`子代理`（12.5px 650，`--c-text`）+ ` · ` + 描述（12.5px，`--c-text2`，max-width 420px 省略，来自 `ev.name` 或首行 prompt）+ ` · ` + 耗时（11.5px mono，`--c-text3`）
- **右缘**：`← 查看详情`（11.5px，`--c-text3`，`opacity: 0`，`.tl-conv .sub-row:hover` 时 `opacity: 1`）——**不做卡片展开**，整行 `cursor: pointer`，点击 `navigateToSubagent(subtaskId)`
- **无展开态**：`.sub-row` 没有 `open` 状态、没有 `sbody`、没有折叠动画——它就是命令执行动作行的形态，唯一的区别是右缘出现"查看详情"而不是"展开结果"
- **状态色**：仅图标着色（running 琥珀闪、completed 绿点、failed 红点、cancelled/timeout 灰点），文字/耗时保持三阶灰，遵循 v4.7「克制用色」
- **详细模式**（`Ctrl+O`）：**不改变**子代理行的折叠形态（子代理内容不进会话流）；只让 tool/thinking/todo 等块展开

**为何不保留「在会话内展开看子代理」的能力**：v4.7 已经证明子代理内容塞进卡片会溢出（"卡片里塞了另一个任务页"）。要深入看子代理，应该跳到子代理页——那里有专门为长会话设计的详情视图，可以复用会话流全部渲染逻辑而不需要再造一套内嵌缩略。**内嵌 = 双份状态机；跳转 = 单一真源**。

## 五、子代理页（新增页签）

### 5.1 位置与进入

- 页签顺序：`对话 | 改动 | 检查点 | 子代理 | 后台`——插入「检查点」与「后台」之间（"检查点"是历史快照、"后台"是 shell，中间放"子代理"从执行产物到运行时的语义递进）
- 页签徽章：`子代理 <running>/<maxSubagents>`（沿用 `.tk-tab-n`）
- 进入路径：① 页签点击 ② 会话页顶部运行条行点击 ③ 会话流子代理行点击
- **不卸载对话**：与现有 diff/cp/shells 页签一致，切换保持对话页挂载与滚动位置

### 5.2 列表视图（首页）

```
┌──────────────────────────────────────────────────────────────┐
│  子代理 · 3 个 · 检索/实现/审查                            ← 页头
│                                                              │
│  ─────────────────────────────────────────────────────────── │
│  ◐ 检索安全网对 stash.apply 的确认策略        8.2s   running │
│     review · explore 模式 · 4 个工具 · 只读                  │
│                                                              │
│  · 实现 Shell 命令终端设计                                     24.0s completed
│     act · 5 个工具 · 编辑 3 个文件 · 冒泡 2 次授权            │
│                                                              │
│  · 代码审查                                              6.1s failed
│     review · 2 个工具 · 失败：模型超时                        │
│                                                              │
│  ─────────────────────────────────────────────────────────── │
│  ▸ 已归档 · 20 个（超出展示上限）                             │
└──────────────────────────────────────────────────────────────┘
```

**规范**：

- **每条子代理 = 一行**，高度 32px（两行文本），`padding: 6px 12px`，hover 背景 `--c-hover`；点击整行进入详情
- **左轨图标** 28px 左轨（与会话页对齐）：`◐`（running，琥珀闪）/ `·`（completed，绿点）/ `·`（failed，红点）/ `·`（cancelled，灰点）
- **第 1 行**（14.5px）：名称（`--c-text`，600，max-width 480px 省略）+ 右缘耗时（11.5px mono，`--c-text3`）+ 右缘状态徽标（`--c-text3` 边框圆角，10.5px）
- **第 2 行**（11.5px，`--c-text3`，`padding-left: 28px`）：`<mode> · <N> 个工具 · <M> 个文件` + 可选「冒泡 N 次授权」/「失败：<原因>」
- **排序**：`running`（升序按启动时间，最老在上）→ `pending/queued` → `failed/timeout` → `completed/cancelled`（都按完成时间倒序，最近的在最上）
- **归档**：超过展示上限（默认 30 条）自动折叠为一行「▸ 已归档 · N 个」，点击展开；对应 `.git/gitter/agent-sessions/<taskId>/subtasks/*.json` 磁盘上仍然保留
- **空态**：本页无任何子代理 = `· 尚无子代理 · 主代理发起 task 工具调用即自动创建`（12.5px，`--c-text3`，居中）

### 5.3 详情视图（点击列表进入）

```
┌──────────────────────────────────────────────────────────────┐
│  ← 返回列表  ◐ 检索安全网对 stash.apply 的确认策略    8.2s    │  ← 页头 34px
│                                                              │
│  你 · 14:31                                                  │  ← 用户气泡（沿用会话页样式）
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 请检查 stash.apply 是否需要确认策略…                    │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ✻ 思考过程 · 正在检索 stash.apply 的授权路径…              │  ← 思考行（v4.7 单行折叠）
│  ⌕ 搜索 · stash.apply --keep-all  …                            │  ← 工具动作行
│  ≡ 读取 · app/src/services/git/stash.ts     · 0.3s            │
│  ⚡ 授权 · 允许 stash.apply?                                │  ← 授权浮层冒泡（若来自子代理）
│                                                              │
│  完成：确认 stash.apply 需要 --keep-all 参数…                │  ← 结论
│                                                              │
│  ─────────────────────────────────────────────────────────── │
│  · 3 个工具 · 4 个思考回合 · 只读工具面 · 未冒泡授权           │  ← 元信息尾行
└──────────────────────────────────────────────────────────────┘
```

**规范**：

- **对话样式 = 会话页样式**（同一套 `TaskTimeline.tsx` + `styles.css`，不新增 `.sub-detail-*`）；页头多一个 `← 返回列表`（12.5px，`--c-text3`，hover `--c-text`，`padding: 0 12px`，`cursor: pointer`）
- **数据源**：`.git/gitter/agent-sessions/<taskId>/subtasks/<subtaskId>.json` 的 `messages` 字段（含 `role: user|assistant|tool`）+ 子代理事件的实时流（若仍 running）；已有持久化，无需新 RPC
- **需要新增的 RPC**：`agent.subtask.list({ taskId })`（返回该任务所有子代理元数据，读磁盘 + live 合并）+ `agent.subtask.transcript({ taskId, subtaskId })`（返回单条子代理的 messages + 已归组的 events）
- **页头状态条**：与列表页行头同风格，`◐`（running 琥珀闪）/ `·`（灰）/ `·`（红）+ 名称 + 耗时（running 时实时更新）
- **底部元信息尾行**：`· N 个工具 · M 个思考回合 · 只读/可写工具面 · 冒泡 N 次授权`（11.5px，`--c-text3`，居中，`padding-top: 16px`）
- **授权/问题浮层**：子代理详情页**不重复实现**授权浮层——若子代理在跑时向用户求授权，浮层仍出现在**主会话页**的 composer 上方（因为 `agent.permission.raised` 是父任务级事件）；用户在详情页看到授权卡片提示（`⚡ 授权 · 允许 stash.apply?` 行）时，右侧出现小徽章「在主会话页回答 →」，点击跳回会话页
- **导航**：`←` 键返回列表；详情页保留滚动位置（返回后再进同一条 = 回到上次的滚动点）

## 六、字号与字重阶梯（沿用 v4.7，仅补充子代理专属）

| 元素 | 规格 |
|---|---|
| 顶部运行条 | 高 22px，`padding: 0 8px`，圆点 4px + 名字 12px + 耗时 11.5px mono |
| 会话内子代理行 | 高 22px，`padding: 2px 8px`，`◐` 16px + 名称 12.5px 650 + 描述 12.5px + 耗时 11.5px mono + 「← 查看详情」11.5px |
| 子代理页列表行 | 高 32px，`padding: 6px 12px`，名称 14.5px 600 + 副行 11.5px + 耗时 11.5px mono + 状态徽标 10.5px |
| 子代理详情页页头 | 高 34px，`← 返回列表` 12.5px + `◐/·` 16px + 名称 14px 600 + 耗时 11.5px mono |
| 详情页元信息尾行 | 11.5px mono，`--c-text3`，居中，`padding-top: 16px` |
| 空态文案 | 12.5px，`--c-text3`，居中 |

## 七、交互清单

- 顶部运行条行点击 → 跳子代理页详情（直接跳详情，不再回列表）
- 会话流子代理行点击 → 跳子代理页详情（同上）
- 子代理页列表行点击 → 进入详情
- 子代理详情页 `←` 键 / 「← 返回列表」点击 → 回列表
- 子代理详情页无授权浮层（`agent.permission.raised.subtaskId` 冒泡时，右侧出现「在主会话页回答 →」跳转徽章）
- 详细模式（Ctrl+O）不改变子代理行折叠形态（子代理内容不进会话流）
- 子代理页切换不卸载对话页（沿用 `.tk-detail` grid 保持挂载）

## 八、数据契约（新增/复用）

**新增 RPC**（挂到 `agent.task.*` 家族下）：

```ts
// 列表：合并磁盘（.git/gitter/agent-sessions/<taskId>/subtasks/*.json）+ live 运行中
agent.subtask.list({ taskId: string }): {
  subtasks: {
    subtaskId: string;
    name: string;
    mode: string;
    state: "running" | "completed" | "failed" | "timeout" | "cancelled";
    startedAt: number;          // 毫秒时间戳
    durationMs?: number;        // 结束态必填
    toolCount: number;          // 派生：events 里 tool 事件计数
    fileCount: number;          // 派生：file-change 事件去重路径数
    permissionBubbles: number;  // 派生：agent.permission.raised.subtaskId 计数
    finalMessage?: string;
    failureReason?: string;     // state=failed/timeout 时填
  }[];
  running: number;
  maxSubagents: number;
  queued: number;               // live.subtaskQueue.length
};

// 详情：子代理自己的消息流（复用主会话消息结构，前端 reduceBlocks 归组）
agent.subtask.transcript({ taskId: string, subtaskId: string }): {
  subtask: /* 同上元数据 */;
  messages: ModelMessage[];      // 磁盘持久化的 messages 字段
  events: SessionJournalEntry[]; // 若 running 则补 live 未落盘事件
};
```

**复用已有事件**（无新增事件类型）：

- `subtask` 事件（`{ subtaskId, name, mode, state, finalMessage, durationMs }`）——顶部运行条与列表页的实时数据源
- `output` 事件带 `subtaskId`——详情页第 N 次访问可回放（磁盘 messages 已有）
- `agent.permission.raised.subtaskId`——详情页显示「在主会话页回答 →」跳转徽章

## 九、影响范围与迁移

| 文件 | 改动 |
|---|---|
| `web/src/pages/TaskTimeline.tsx` | `SubtaskBlock` 单行化：去 `open` 状态与展开体；行尾加「← 查看详情」；`onClick` 触发 `ctx.openSubagent?.(subtaskId)` |
| `web/src/pages/TasksPage.tsx` | ① 页头下方插入运行条（`runningSubs>0 || queuedSubs>0` 时显示）② 页签顺序插入「子代理」③ 新增 `<SubagentsTab taskId ... />` 子组件（列表 + 详情，内部状态管理）④ 会话流 renderCtx 挂 `openSubagent` 回调 |
| `web/src/styles.css` | 新增 `.tk-subrun`（运行条）、`.sub-row`（会话内子代理行，复用 `.tl-turn` 视觉）、`.tk-sub-list` / `.tk-sub-detail`（子代理页） |
| `app/src/services/agents/session.ts` | 新增 `subtaskList` / `subtaskTranscript` 方法 |
| `app/src/bridge.ts` | 注册 `agent.subtask.list` / `agent.subtask.transcript` |
| `web/src/bridge/types.ts` | 补充方法名与返回类型 |
| `app/src/services/agents/types.ts` | 无新增事件（复用现有） |

**不做的事**：

- 不改造子代理持久化格式（`.git/gitter/agent-sessions/<taskId>/subtasks/*.json` 已够）
- 不改 spawnSubtask 并发限流（沿用 `settings.agents.maxSubagents`）
- 不改授权浮层（子代理冒泡授权仍在主会话页承接）
- 不在子代理详情页做 composer（子代理是只读产物；追加 prompt 无意义）

## 十、开放问题

1. **子代理页 vs 独立顶层页面**：本稿把子代理作为任务详情页签。若后续跨任务汇总需求（"我所有子代理的历史"）出现，需升级为顶层页面。当前仅任务维度。
2. **子代理详情页的 `← 返回列表` vs 面包屑**：短路径用左箭头，深路径（未来若加入嵌套子代理）改面包屑。当前一律左箭头。
3. **列表页排序是否可切**：本稿固定排序（running→queued→failed→completed 倒序）。若用户偏好自定义排序，加一个 `◐ 按启动 / 按完成` 切换钮在页头右侧。**当前不做**——30 条内排序足够，避免过早抽象。
4. **子代理页是否显示父任务上下文**：本稿只显示子代理自己的会话。若用户在详情页需要看父任务的对应回合，加一个「父上下文 →」跳回会话页并滚动到对应子代理行。**当前不做**——跳转路径已在顶部运行条上给出。

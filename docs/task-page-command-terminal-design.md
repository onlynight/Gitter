# 任务页设计稿 —— 命令执行可观测性：中断归约 × 卡片点击跳「后台」tab

> 状态：设计提案 v2（2026-10-13）。v1 → v2 修订：**取消「改动面板内新增终端 tab」**——会话顶部已有「后台」tab，用户明确要求复用，不在右侧新开区域。改为「点击命令卡 → 跳转『后台』tab 并选中对应条目」。
> 可视原型：`design/task-command-terminal-mockup.html`（浏览器直接打开；可点击：卡片展开/终端入口/任务切换对比）。
> 前置版本：本稿建立在 `task-page-v4-session-design.md`（v4.7）之上，页签结构沿用 v3（对话/改动/检查点/后台），不改动会话流排版公理。

## 零、问题陈述（用户报告）

1. **已停止的任务，打开会话窗口后执行命令就开始记时了。**
2. **执行中的命令不能点击，无法查看终端的执行情况。**
3. **执行情况应在右侧打开一个新的 tab，显示终端的执行过程及结果。**

**v2 裁决（用户追加）**：#3 的目标形态改为——点击后跳转已有的「后台」tab，选中跳转过来的后台任务查看详情。**不新建 tab 区域**。

三项已确认为一个根因链的不同切面：`terminal_run` 工具块一旦缺少终结事件就永久停留 `running`（#1 的计数永不停止），而卡片交互从未接通过终端（#2、#3 是同一个缺口的两个方向）。

---

## 一、根因定位（设计依据，非修复方案）

| 症状 | 代码事实 | 位置 |
|---|---|---|
| 记时永不停 | `runningTool` 只判 `block.state === "running"`，**不检查任务是否存活**；1Hz tick 只要有 running 块就开 | `TasksPage.tsx:707-716`、`:739-743` |
| 琥珀脉冲药丸 | `执行命令 65.0s` = `Date.now() - startTs` 持续跑，无上限 | `TasksPage.tsx:1660-1665` |
| busyHint | 同 `startTs` 差值，无任务状态门控 | `TasksPage.tsx:1466-1468` |
| 块永久 running | `loop.ts` abort 分支不遍历 `openCalls` 补发 `tool/end`；journal 持久化 → 孤儿块**跨重启保留** | `agents/loop.ts:264-279`、`session.ts:2024` |
| 卡片不可点终端 | `TimelineCardCtx` 只有 `viewFile`/`previewFile`，**无终端钩子**；`.v47-hd` 的 onClick 仅折叠 | `agentUIRegistry.ts:16-32`、`TaskTimeline.tsx:298-312` |
| 「后台」tab 只是列表 | `ShellsTab` 是**只读快照列表**（2s 轮询 `agent.task.shells`），无「选中查看详情」态；点击条目无任何反应 | `TaskDetailPages.tsx:200-274` |
| shell 无流式通道 | `AgentShellDTO` 只有 `tail`（2000 字符快照），**无输出事件通道**；注释明确写「轮询足够」 | `TaskDetailPages.tsx:220`、`bridge/types.ts:591-598` |
| 前台命令无流 | `emitDelta` 里 `if (id && ...)` —— `id` 仅后台模式非 null，**前台从不流式** | `agents/builtinTools.ts:636-644` |
| `AgentShellDTO` 无 session 关联 | 只有 `id/command/running/exitCode/tail`，与 `tool/start` 的 `callId` 无映射，**卡片无法定位到具体 shell** | `bridge/types.ts:591-598` |
| shell 仅 live 有数据 | `taskShells` 只查 `this.live.get(taskId)`，**非 live 返回空**；重启后 shell 全丢 | `session.ts:1274-1281` |

**关键判别**：本稿把「记时」与「可观测」拆成两个正交问题分别收敛——记时的真值必须来自**任务存活性**（Block 里无任务状态字段，reducer 内无法自证）；可观测的通路必须解决「后台 tab 只有列表、没有详情」与「前台命令根本没进后台」两个缺口。

---

## 二、方案裁决（已与用户确认）

| 裁决点 | 选择 | 理由 |
|---|---|---|
| 终端显示位置 | **跳转已有的「后台」tab + 选中对应条目展开详情** | 顶部四 tab 已有「后台」；不复用会造成两个终端入口、语义分裂 |
| 已停止任务的处理 | **归约为「已中断」** | 只在渲染层门控会止血但底层 block 仍标 running，历史回放状态不精确；归约一次性清干净 |

---

## 三、记时与状态归约（问题 #1）

### 3.1 真值来源

「这条命令还在不在跑」的**唯一真值是任务存活性**，不是块状态。块状态只记录「后端有没有发出终结事件」——而 abort 路径从不发。因此：

> **规则**：`live = LIVE_STATES.has(task.state)`（`TasksPage.tsx:28` 已有）；时间线里任何 `state === "running"` 的工具块，若所属任务非 live，**在渲染层读取边界归约为 `aborted`**。

归约发生在渲染层（`TasksPage` 计算 blocks 之后、交给 `TaskTimeline` 之前），而非 reducer 内部——reducer 拿不到 `task.state`（Block 无 `taskId` 字段），在那里修等于给每个块加任务关联，成本高且污染块模型。

### 3.2 新块状态

```
running  →  ok | error | aborted     （aborted 为新增终态）
```

| 状态 | 触发 | 计时 | 图标 | 行尾摘要 | 可跳后台 |
|---|---|---|---|---|---|
| `running`（真跑） | 任务 live 且 block running | 是，`startTs` 起累计 | 琥珀闪烁 | `运行中 · 12.3s`（琥珀） | 是 |
| `running`（孤儿，live 内） | 任务 live 但超时无事件 | 是，累计到上限 | 琥珀闪烁 | `无响应 · 30.0s` | 是 |
| `aborted` | 任务非 live 时归约 | **否，冻结在归约时刻** | 灰色 | `已中断 · 47s`（dim2） | 是（看已捕获输出） |
| `ok` / `error` | 后端终结事件 | 否 | 正常 / 红 | `· 0.3s` / `失败 · exit 1` | 前台命令：无对应 shell，灰显 |

**冻结语义**：`aborted` 的耗时 = `归约时刻 - startTs`，此后不再变动。归约是幂等的（已 `aborted` 的跳过）。

### 3.3 live 任务内的孤儿块（补充保护）

任务显示 live 但某条命令卡住不动（后端崩溃、pty 挂起、网络断），当前设计会让计数无限涨。**规则**：live 任务的 running 块累计超过 **30s 无新事件**时，药丸与 busyHint 文本切到 `无响应 · Ns`（保持琥珀但语义转为告警），不自动归约成 `aborted`（live 状态下它理论上仍可能返回）。

### 3.4 后端补终结事件（治本，与 3.1 并行）

`loop.ts` abort 分支退出前遍历 `openCalls`，为每个未闭合 call 补发一次终结事件：

```
type: "tool", phase: "end", callId, isError: true,
result: "命令已中断（会话停止）。" + (已捕获输出), durationMs: now - start
```

归约（前端）负责**历史**里的孤儿块（journal 已持久化，补事件追不回过去）；补事件负责**增量**。两者互补，缺一不可——只做归约则每次停止都会产生新孤儿块；只做补事件则历史里的孤儿永久闪烁。

---

## 四、卡片可点击 → 跳「后台」tab（问题 #2）

### 4.1 交互面

命令卡的动作行**保持整行可点 = 折叠/展开**（v4.7 既有语义，不改），右侧追加一枚**独立的终端入口图标**：

```
[终端图标] 执行命令   cd D:\Code\Gitter\app && node -e "..."   · 0.3s    [⤴]
```

- 入口图标仅 `terminal_run` / `terminal_poll` 两类块显示（其他工具无 shell 对应）。
- 图标：终端提示符 + 右上箭头（`↗` 变体），16px 线性、描边 2.25，与左轨图标同规格；默认 dim，hover 转 text。
- `title="在后台中查看执行详情"`。
- 点击**不折叠**卡片（`stopPropagation`）——用户能同时保留卡片上下文并看详情。

选独立图标而非整卡点击，是为了不与 v4.7 的「点击动作行 = 单行↔全文切换」冲突。整卡语义已被展开占用，跳转终端是**第二个动作**。

### 4.2 点击行为

点击 `⤴`：

1. `setTab("shells")` —— 切到「后台」tab。
2. 通过 `shellFocus` 状态把该命令对应的 `shellId` 传给 `ShellsTab`（同 v4.7 已有的 `panelReq`/`fileFocus` 模式，加 `ts` 防同值去重）。
3. `ShellsTab` 接收后**展开**该条目为详情态，并把详情区滚到可视。

图标状态反映跳转结果：

| 块状态 | 图标 | 点击行为 |
|---|---|---|
| `running` | 正常，图标琥珀 | 跳后台 + 展开；条目在详情里带琥珀脉冲 |
| `aborted` | 正常，灰色 | 跳后台 + 展开；详情显已捕获输出 + 中断标记 |
| `ok` / `error`（后台模式） | 正常，灰色 | 跳后台 + 展开；详情显完整输出与退出码 |
| `ok` / `error`（**前台模式**） | **灰显**，`title="该命令未转后台，无对应 shell"` | 不响应 |
| **无会话**（历史孤儿、重启后） | **灰显**，`title="后台 shell 仅 live 会话保留"` | 不响应 |

无会话场景必须明确灰显而非静默——用户点了没反应是最坏的体验。

### 4.3 前台命令怎么办（本设计的核心张力）

现状：**前台命令不进 `env.shells`**，`agent.task.shells` 拿不到它，「后台」tab 里根本不存在前台命令的条目。这是用户诉求（#2「执行中的命令不能点击查看」）与既有架构（#3 指向「后台」tab）的冲突点。

**裁决：前台命令也登记进 `env.shells`，但标 `foreground: true`**——让它出现在「后台」tab 的条目列表里，与真正的后台 shell 可区分（图标/标签加一枚「前台」小字标记）。理由：

- 用户的诉求是「看这条命令的执行详情」，不是「这条命令必须是后台的」。前台命令同样是命令，同样有输出，同样值得看。
- 「后台」tab 的语义从「仅后台 shell」泛化为「命令执行记录」，标题随之从 `后台` 微调为 `后台 / 命令`（保留原 tab 位与图标，不新增 tab）。
- 不改命令的执行语义（前台命令仍同步等待、结果仍进时间线），只多做一次**注册**。

**不做的替代方案**：「仅后台命令可跳转、前台命令灰显」——这会让用户报告的核心场景（截图里 `cd D:\Code\Gitter\app && node -e ...` 就是前台命令）无法响应，等于没修。

---

## 五、「后台」tab 的详情态（问题 #3）

### 5.1 列表 → 详情的两级结构

现状 `ShellsTab` 只有列表。**改为两级**：默认列表态（保持现状），点击条目（或从卡片跳转）进入该条目的详情态，详情区在列表下方展开（不替换列表，保留上下文）。

```
┌ 后台 ──────────────────────────────────────────────── 刷新 ┐
│ ● cd D:\Code\Gitter\app && node -e "const {Registry}..."   │ 运行中
│   ┌─ 详情（展开）─────────────────────────────────────────┐ │
│   │ $ cd D:\Code\Gitter\app && node -e "const {Registry}...│ │
│   │ npm notice run gitter-app@0.1.0 build                 │ │
│   │ src/main.ts(206,26): error TS2769: ...                 │ │
│   │ ⎮ 已捕获 1,284 字符 · 运行中 · 已 47s                  │ │
│   └────────────────────────────────────────────────────────┘ │
│ ○ npm run build                                            │ exit 0
│ ◉ git push                                               │ 失败
└─────────────────────────────────────────────────────────────┘
```

- **列表行**：保持现状（状态点 + 命令 + 耗时/退出码 + 终止按钮）。新增：点击行切换展开/收起详情（与卡片折叠语义一致，整行可点）。
- **前台/后台标记**：行首追加 `前` / `后` 小字徽标（dim2，10px），避免用户混淆两类命令。
- **详情区**：列表下方内联展开，`max-height` 360px 内滚动（滚动条 8px，同 v4.7 读出框规格）。
- **仅展开一条**：展开新条目时收起上一条（避免详情区堆叠）。
- **详情结构**：命令行回显行（`$` 前缀 dim2）+ 输出体（mono 12.5px / 行高 20px，ANSI 颜色转义保留）+ 底部状态行（`已捕获 N 字符 · 运行中/exit N/已中断 · 已 Ts`）。
- **自动跟随**：详情区在新输出到达时自动滚到底；用户手动上滚即暂停跟随，出现「↓ 回到最新」浮动钮（同终端惯例）。
- **实时性**：详情页内**不轮询**，改为订阅输出事件（见 §5.2）；列表级仍 2s 轮询（保持现状，成本可控）。

### 5.2 输出事件通道（新）

现状是 2s 轮询 + 2000 字符 `tail` 快照，「看执行过程」做不到。新增一个事件通道：

```
method: "agent.shell.output"
params: { taskId, shellId, chunk, eof: boolean }
```

- 主进程在 `emitDelta` 时**顺带**发一次（去掉 `id &&` 守卫后前台也发），与现有 `agent.event` 的 `output/stream:"tool"` 事件并行不冲突（后者给时间线卡片用，前者给详情页用）。
- 前端 `ShellsTab` 详情页订阅，增量追加到本地缓冲（环形，上限 128KB），超出头部截断并在顶部提示 `… 已截断 N 字符`。
- `eof: true` 标记命令结束，详情区停止自动跟随。
- **列表级仍轮询**：事件只驱动已展开的详情页，未展开的条目靠 2s 轮询刷新状态（状态变化才需要，不需要流）。这是刻意的双轨——全量事件化会让所有 shell 都推流，浪费 IPC。

### 5.3 非 live 会话（历史回看）

现状 `taskShells` 只查 `this.live`，非 live 返回空——**重启后看不到任何命令执行历史**。这与本设计冲突（#1 的已停止任务正是非 live）。

**裁决：shell 记录持久化到 session journal**。每次 shell 完成（`running: false`）或会话停止时，把该 shell 的 `output`（上限 128KB）+ 元数据写入 journal；`taskShells` 合并 live 内存 + journal 持久化两部分，后者标 `persisted: true`（详情区显「已归档 · 重启后恢复」）。

不持久化的替代方案是「非 live 任务的命令卡终端入口灰显」——但这样 #1 的已停止任务点不进详情，用户仍看不到执行了什么，等于半修。

---

## 六、后端契约（不可省，本稿的实现前置）

以下六项必须一起落地，缺一项前端就是空壳：

### 6.1 `tool/start` 携带 shellId

```diff
  emit({ type: "tool", phase: "start", callId, name: "terminal_run", args });
+ // args 内含 shellId —— 与 env.shells 的键同源
```

当前后台模式的 `sh-N-ts` 只存在于返回文本里（`builtinTools.ts:671-675`），前端拿不到。**改为放进 `args.shellId`**，前端据此关联卡片 ↔ shell 条目。

### 6.2 前台命令也登记 shell

```diff
- return run(null);
+ const id = `sh-${env.shells.size + 1}-${Date.now().toString(36)}`;
+ env.shells.set(id, { id, command, output: "", running: true, exitCode: null,
+                      startedAt: Date.now(), foreground: true });
+ return run(id);
```

`ShellRecord` 加 `foreground?: boolean` 字段。`emitDelta` 的 `id &&` 守卫**去掉**——前台也流式。

### 6.3 新增 `agent.shell.output` 事件通道

见 §5.2。

### 6.4 `AgentShellDTO` 扩字段

```diff
  export type AgentShellDTO = {
    id: string; command: string; running: boolean; exitCode: number | null; tail: string;
+   shellId: string;       // 与 tool/start 的 args.shellId 同源（id 已存在，此处显式对齐命名）
+   foreground: boolean;   // 前台/后台标记
+   startedAt: number;     // 供归约时计算冻结耗时
+   persisted: boolean;    // 是否来自 journal（非 live 历史回看）
  };
```

### 6.5 abort 补终结事件

见 §3.4。

### 6.6 shell 持久化到 journal

见 §5.3。新增 RPC `agent.shell.output`（按 `shellId` 拉取，上限 128KB，超出取尾）作为事件通道的兜底——事件丢失时详情页可从这里重建。

---

## 七、交互清单（汇总）

- 已停止任务里所有 `running` 块在加载时归约为 `aborted`：**不计时、不闪烁、耗时冻结在归约时刻**、行尾 `已中断 · Ns`
- live 任务内 running 块超 30s 无事件 → 文本切 `无响应 · Ns`（保持琥珀，不自动归约）
- 命令卡动作行整行点击 = 折叠/展开（**不变**）；行尾新增终端入口图标（`terminal_run`/`terminal_poll` 专属）
- 终端入口图标 `stopPropagation`，不折叠卡片；前台命令无 shell 时灰显并提示（本设计下前台也注册 shell，此场景仅剩历史孤儿）
- 点击 `⤴` → `setTab("shells")` + 通过 `shellFocus` 选中并展开对应条目详情
- 「后台」tab 从纯列表升级为「列表 + 单条详情展开」两级；详情内联在列表下方，`max-height` 360px 滚动
- 详情：命令行回显 + 输出流 + 底部状态行（已捕获字符 / 运行中或 exit N / 已 Ts）
- 详情页实时跟随输出（订阅事件），用户上滚暂停跟随并出「↓ 回到最新」
- shell 条目行首加 `前`/`后` 徽标区分前台与后台命令；tab 标题微调为 `后台 / 命令`
- 非 live 任务通过 journal 持久化回看历史命令（标 `已归档`）
- 后端六件套：`tool/start` 带 `shellId`、前台也登记 shell、新增输出事件、`AgentShellDTO` 扩字段、abort 补 `tool/end`、shell 持久化到 journal

## 八、不做的事（明确边界）

- **不新建「终端」tab、不在改动面板加 tab**：顶部已有「后台」，复用之（用户裁决 v2）。
- **不改 tab 的联合类型**：`"chat" | "diff" | "cp" | "shells"` 保持，不新增分支。
- **不做交互式终端接手**：`terminal_run` 是 `child_process.spawn` 不是 pty，没有真会话可 attach。做「接手」等于重跑命令，语义陷阱。
- **不做全量事件化列表**：事件只驱动已展开的详情页；列表级保持 2s 轮询，避免所有 shell 都推流。
- **不改 v4.7 会话流排版公理**：卡片展开语义、读出框规格、图标规格全部沿用，本稿只加终端入口图标与状态归约。
- **不改 `ShellsTab` 的位置与挂载方式**：仍是 `TasksPage` 的 `tab === "shells"` 分支，仍是 2s 轮询 + `onCount` 上报徽标。

## 九、开放问题（实现前需裁决）

1. **归约是否写回 journal？** 倾向：渲染层归约 + 后端补事件（§3.4）双轨，不写回 journal（避免修改已落盘历史）。
2. **`agent.shell.output` 环形缓冲 128KB 是否够？** 大文件构建（tsc、vite）可能超。备选 512KB，或前端本地截断 + 提示。倾向：128KB + 头部截断提示。
3. **`terminal_poll` 的输出流目前被 reducer 丢弃**（`TaskTimeline.tsx:119-128` 只匹配 `name === "terminal_run"`）。实现时一并放开匹配，否则后台命令的时间线流式输出仍丢。
4. **前台命令标 `foreground: true` 后，tab 徽标计数是否包含前台命令？** 倾向：包含（用户看到的是「还在跑的命令数」，不区分前后台）。

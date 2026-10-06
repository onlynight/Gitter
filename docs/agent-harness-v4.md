# Gitter Agent Harness v4.0 —— 完整 AI 编程工具化设计

> 状态：设计提案 v4.0（2026-10-07），**仅设计方案，未动代码**
> 定位：在 v3.0（自身即 agent 运行时，A1–A4 已落地）基础上，把 Gitter Agent 从"一个能对话的框"补齐为对标完整 Codex / ZCode 的 AI 编程工具——能读写项目、用工具干活、压缩上下文、预览与回滚每一次编辑
> 关系：继承 v3.0 全部底座（事件族 / 任务账本 / 授权卡 / 托管 checkpoint / 任务卡两栏 UI / 任务型与模型档案链）；**推翻 v3.0 §十一"不做子代理 / plan 模式"的边界裁决（v4 正式纳入）**；吸收 tool-agent-fusion.md D 阶段（Agent 循环消费统一 ToolRegistry）
> **补充 v4.1（2026-10-07，同日）：全插件化设计（§十四）**——用户裁决"重要的是全插件化"：Agent 能力面 100% 贡献点化，内置能力与第三方插件走同一批接缝（内置自举注册、同槽位竞争），原则是"**数据可插件，引擎不插件**"
> **补充 v4.2（2026-10-07，同日）：plan 模式与子代理为 v4 必达能力**——§九/§十 深化为完整分册：plan 全生命周期（调研→提交→批准→执行衔接→修订链）、子代理同步并发模型（AI SDK 并行 tool-call + 信号量限流）、权限矩阵、plan×子代理联动（规划期只许 explore）
> 阅读顺序：§〇 缺口矩阵（先看）→ §一 架构 → §二~§十三 功能分册 F1–F12 → §十四 全插件化 → §十五 协议汇总 → §十六 配置增量 → §十七 路线 B1–B6

---

## 〇、现状盘点与缺口矩阵

### 0.1 对照矩阵（对标 Codex / ZCode）

| 能力 | Codex | ZCode | Gitter 现状（v3.4） | 缺口分册 |
|---|---|---|---|---|
| 多轮记忆 | 会话内完整 | 完整 | **缺失（P0）**：assistant/tool 消息从未回写历史 | F1 |
| 读文件 | 分页 + 行号 | 行号 + 截断策略 | 64KB 整读，无行号无分页 | F2 |
| 检索（glob/grep） | shell + 内置 | Glob/Grep 工具 | **无**（list_files 扁平 200 条） | F2 |
| 写文件/编辑 | apply_patch | Write/Edit（写前读校验） | 盲写 + 单次 patch，错误提示弱 | F3 |
| 命令执行 | 沙箱 shell | 流式输出/后台任务 | 一次性 spawn，120s，无流式无后台 | F4 |
| 权限 | 审批模式三档 | 权限模式四档 + 规则 | 三级授权卡（会话内记忆，无持久规则） | F5 |
| 编辑预览 | IDE diff 面板 | diff 卡 + 逐文件还原 | 时间线一行 `+path`，无 diff 无还原 | F6 |
| 检查点 | /rewind | 回溯 | turn 边界 checkpoint 已有，**无恢复 UI** | F6 |
| 上下文压缩 | /compact + 自动 | 自动 + 手动 compact | **无**（消息无限增长直到爆窗） | F7 |
| 计划模式 | plan 工具 | plan 模式 + 计划批准 | 无 | F8 |
| 任务清单 | plan/更新 | TodoWrite | 无 | F8 |
| 子代理 | —（并行脚本） | Agent 工具 | 无 | F9 |
| 输入增强 | @提及/图片 | @文件/skills/图片/排队 | 纯文本框 | F10 |
| 工具调用可视化 | 命令卡 | 工具卡（参数/结果/耗时） | 一行 status 文本 | F11 |
| 重试/降级 | 有 | 有 | 无（一次失败即 failed） | F12 |
| AGENTS.md | 分层 | 分层 + 全局 | 仅仓库根，2000 字符 | F7 |
| MCP/插件工具 | MCP | MCP + 插件工具 | MCP 客户端已有，**未接入循环** | F12 |

### 0.2 P0 事实缺陷（先于一切功能修复）

1. **会话历史不回写**：`loop.ts` 的 `streamText` 结束后，`result.response` 中的 assistant / tool 消息从未追加进 `live.messages`（session.ts `startTurn` 也不补），`lastMessage` 只是摘要。**续跑 = 只带用户消息历史，模型对前几轮自己做过什么完全失忆**。多轮任务实际是"每轮重来"。
2. **主进程同步 IO**：tools.ts / prompts.ts 全部使用 `readFileSync / writeFileSync / readdirSync`，阻塞 Electron 主进程事件循环——大文件或慢盘会冻结全部窗口的 RPC。
3. **fork 共享 worktree**：`fork()` 直接 `{...source}` 复制 `worktreePath`，分叉任务与源任务在同一分支上互相踩。

### 0.3 结论

v3.0 的"验收台闭环"定位仍然成立且是差异化卖点（AI 生产、人验收）；但缺少上述能力时 agent 只能做"一轮写完的小任务"。v4 的目标是让 agent 能**自主完成多轮、大范围、可回滚的真实编码任务**，同时把 Gitter 的验收台优势放大（每次编辑可见、可回滚、可送审）。

---

## 一、总体架构 v4

```
┌─────────────────────────── Electron 主进程（L2，执行权不出宿主）─────────────────────────────┐
│                                                                                              │
│  AgentLoop（AI SDK streamText 多步循环）                                                      │
│    ├─ 消息回写：response.messages → 会话历史（F1，修复 P0-1）                                  │
│    ├─ 重试退避 / maxSteps 可配 / 防死循环提醒（F12）                                            │
│    ├─ 上下文预算表 + 自动压缩（F7）                                                            │
│    └─ 子会话编排（F9，explore/act 子代理，深度 1）                                              │
│                                                                                              │
│  AgentToolset v2（F2/F3/F4：读面 / 写面 / 命令面）                                             │
│    ├─ 读：repo_read_file(v2 分页) / repo_glob / repo_grep / repo_status / repo_diff / repo_log│
│    ├─ 写：file_write / file_patch(v2 批量+原子) —— 写前读校验 + diff 回执                       │
│    ├─ 命令：terminal_run(v2 流式/后台) + terminal_poll                                        │
│    ├─ 交互：ask_user / todo_write / plan_submit（模式专属）                                    │
│    ├─ git 写：git_stage / git_commit / git_push（授权卡不变）                                  │
│    └─ 来源扩展：插件 agentTools（F12）/ MCP 工具（F12）/ L3 封存不变                            │
│                                                                                              │
│  AgentSessionManager（F1/F5/F6/F7）                                                           │
│    ├─ 会话文件 v2：messages（完整回写）+ journal 分段 + compactions + usageHistory             │
│    ├─ 权限模式（plan/default/yolo）+ 授权卡 v2（结构化 payload + 持久规则）                      │
│    └─ ChangeSet 缓存 + checkpoint 索引（改动预览数据源，F6）                                    │
│                                                                                              │
├──────────────── preload bridge（现有，形状兼容扩展）───────────────────────────────────────────┤
│  web/ 渲染层                                                                                  │
│    任务详情页签：[对话：时间线 v2 工具卡/计划卡/diff mini 卡] [改动：文件列表+DiffView]          │
│                [检查点：时间线+恢复]                                                          │
│    输入台：@ 提及 / 斜杠命令 / 图片附件 / 排队投递 / 模式切换 / 上下文表                          │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**安全不变量（全部继承，一条不加宽）**："决策可下放，执行不下放"。fs 活动面仍锁任务 worktree（新增 symlink realpath 校验）；git 写仍过授权卡；push 恒 each-time；checkpoint 仍是唯一免卡写；yolo 模式也只是"免卡"，不是"越权"——工具面本身不变。

---

## 二、F1 会话与消息模型 v2（含 P0 修复）

**目标**：多轮会话真实可用；历史可分页回放；IO 不阻塞主进程。

### 2.1 消息回写（P0 修复）

- `builtinLoop` 收尾处：`const resp = await result.response;` 将 `resp.messages`（assistant 文本 + tool-call/tool-result 配对消息）追加进 `o.messages`（宿主传入的同一数组引用），由 session 层照常持久化。
- 中断（abort）时：已完成的 steps 的消息同样回写（`resp.messages` 含中断前的完整步），未完成的半截文本以 user 侧 `system-reminder`（"上一轮被中断于此"）补记，避免工具配对断裂。
- 验收：同一任务连跑三轮"我上一步改了哪个文件"，模型能准确回答。

### 2.2 会话文件 v2

```
.git/gitter/agent-sessions/<taskId>.json   →  v2 结构：
{ version: 2, taskId,
  messages: ModelMessage[],              // 完整回写后成为唯一事实源
  compactions: [{ ts, removedCount, tokensBefore, tokensAfter, summary }],
  usageHistory: [{ ts, input, output }] }
.git/gitter/agent-sessions/<taskId>/journal-<n>.json   // journal 分段：每段 500 条，追加新段
```

- 迁移：读到 `version: 1` → 补默认字段照常使用，下次写回升级为 v2；journal 旧单体文件读入后按 500 条切段。
- `agent.task.history` RPC 增加 `{ before?: ts, limit?: number }` 分页参数（向后兼容：不传 = 现行为）。

### 2.3 同步 IO 全量异步化

- tools.ts / prompts.ts / checkpoint.ts 的 fs 调用改 `fs/promises`；`repo_list_files` 的递归 walk 改异步并加并发上限 8。
- 验收：读 10MB 文件时 UI 其他 RPC 不卡顿（现会冻结）。

### 2.4 fork 语义修复（P0-3）

- fork 必建新 worktree：`task/<原slug>-fork`（去重追加 -2/-3），复制消息历史，`baselineSha` 取新 worktree HEAD。
- fork 卡与源任务卡互相显示"分叉自/分叉出"链接。

---

## 三、F2 项目读工具面（read / glob / grep）

**目标**：模型能在大仓库里自主定位代码，而不是靠 200 条扁平列表猜。

### 3.1 repo_read_file v2

```ts
input: { path: string, offsetLine?: number, lineCount?: number }   // 默认从第 1 行读
```

- 输出 `cat -n` 风格（每行带行号，便于 patch 引用与模型定位）；默认上限 2000 行 / 96KB（先到者生效）。
- 尾注：`（第 X–Y 行，共 Z 行；续读用 offsetLine）`；文件为空 → `（空文件）`。
- 二进制嗅探：首 8KB 含 `\0` → 拒读，返回文件大小 + 按扩展名的类型猜测。
- 图像扩展名（png/jpg/jpeg/gif/webp/svg/ico）→ 返回占位说明并发出 `{type:"file-change", path, kind:"read-image"}` 事件（UI 附件预览；多模态模型的 base64 注入见 F10）。
- CRLF 保持原样不转换（patch 精确匹配依赖原始内容）。
- **读取登记**：成功读取后记入 `LiveSession.readLog: Map<relPath, { mtimeMs, size }>`（F3 写前读校验的数据源）。

### 3.2 repo_glob（新增）

```ts
input: { pattern: string, dir?: string }   // pattern 如 "src/**/*.ts"、"*.json"
```

- 实现：`git ls-files -co --exclude-standard`（尊重 .gitignore 且含未跟踪文件）+ minimatch 匹配（新增依赖 `minimatch`，纯 JS 无原生模块）。
- 输出相对路径列表，cap 200 条 + `（共 N 个命中，仅显示前 200；请缩小 pattern 或加 dir）`；0 命中 → 提示放宽建议。
- 权限 auto。

### 3.3 repo_grep（新增）

```ts
input: { pattern: string, glob?: string, dir?: string, ignoreCase?: boolean, maxResults?: number /*默认 100*/ }
```

- 实现：PATH 探测到 `rg`（ripgrep）优先走 `rg -n --no-heading -I`（快、默认递归、rust 正则）；否则退 `git grep -nI --untracked`。两者的正则方言差异写进工具 description（`rg` 支持 `\d` 简写，git grep 用 POSIX）。
- 输出 `path:line:text`，cap maxResults 条 + 截断说明；二进制文件跳过。
- 权限 auto。

### 3.4 旧工具降级

- `repo_list_files` 保留（兜底），description 改为"仅适用于小目录速览，检索请用 repo_glob / repo_grep"。

---

## 四、F3 项目写工具面（write / patch v2）

**目标**：编辑可靠、可自纠；每次写都有 diff 回执喂给改动预览（F6）。

### 4.1 file_patch v2（对标 ZCode Edit）

```ts
input: {
  path: string,
  edits: Array<{ oldString: string, newString: string }>,  // 单编辑也走 edits[0]
  replaceAll?: boolean                                       // 对所有 edit 生效
}
```

- **原子性**：所有 edit 的 oldString 定位成功才一次性落盘；任一失败 → 整体不写，逐条报错。
- **错误自纠增强**（现仅"不存在/多次出现"两种）：
  - 0 次命中 → 附加最近相似位置：按 3 行滑动窗口与 oldString 首行做相似度（最长公共子串 ≥ 0.6）扫描，报 `可能位置：L<line>，请核对缩进与行尾`；
  - 多次命中且未 replaceAll → 列出全部命中行号。
- CRLF：匹配前不做归一化；提供仅当文件为 CRLF 且 oldString 含 `\n` 时给出明确报错提示（"文件为 CRLF 行尾，oldString 请包含 \r"），避免模型反复盲试。

### 4.2 写前读校验（对标 ZCode read-before-edit，仅 file_patch 硬约束）

- 目标文件必须 (a) 本会话经 `repo_read_file` 读过（在 readLog 中），且 (b) 读后 mtime 未变。违反 → 错误文本：`文件尚未读取或已被外部修改，请先 repo_read_file`。
- `file_write` 不做硬校验（新建文件无"读"可言），但对已存在文件且 readLog 无记录/已变化的情况，在成功回执中附警告文本。

### 4.3 diff 回执与护栏

- 写工具成功后：对变更前后内容计算 unified diff 统计（`+N −M`）与 hunk 数据，缓存进 ChangeSet（F6），并发出 `{type:"file-change", path, kind, summary:"+N −M"}`。
- 护栏：单次 `content` ≤ 512KB；patch 后文件 ≤ 2MB；超出报错不写。
- 权限维持 auto（worktree 隔离即沙箱），风险面由 F6 的可见性 + F5 的模式开关承接。

---

## 五、F4 命令执行 v2（terminal_run / terminal_poll）

**目标**：跑测试/构建的体验对标真终端：输出实时可见、长任务可后台、危险命令有闸门。

### 5.1 terminal_run v2

```ts
input: { command: string, timeoutMs?: number /*默认 120000，上限 600000*/,
         cwd?: string /*worktree 内相对路径*/, background?: boolean }
```

- **前台流式**：spawn 起进程，stdout/stderr 增量 → `{type:"output", stream:"tool"}` 事件（120ms 节流，环形缓冲 64KB），UI 工具卡尾部实时 tail；完成返回 `退出码 N` + 输出（头 8KB + 尾 8KB，中间省略处标注省略字符数）。
- **后台模式**：`background: true` → 立即返回 `shellId`；输出持续经事件流；任务 turn 结束仍在运行的后台 shell 保留（记录提示，不自动杀；checkpoint 前若 shell 仍在写文件给出警告）。
- **超时**：Windows 下 `taskkill /PID <pid> /T /F` 杀整棵进程树（现 `child.kill()` 杀不干净 npm→node 链）。
- **逃生舱联动**：`shellId` 可附着到任务卡终端区查看（TerminalManager 的 node-pty 会话复用）；前台模式保持 spawn 管道捕获（不引入 pty 的回显/控制序列复杂度）。

### 5.2 terminal_poll（新增）

```ts
input: { shellId: string, waitSec?: number /*最多 60*/ }
```
返回该后台 shell 的累计输出（尾部 8KB）与运行状态；权限与 terminal_run 同级（session）。

### 5.3 危险命令分级（safety.ts 扩展）

- 新增 `commandRisk(command): "high" | "medium" | null`：
  - **high**（强制 each-time + 卡片红条）：`format`、`rd /s`、`del /s`、`rm -rf`、`git reset --hard`（对主分支语义）、`git push --force*`、`mkfs`、`reg delete`、`diskpart`…
  - **medium**（卡片黄条）：`git checkout -- <paths>`、`git clean`、覆盖型重定向 `> 已存在的二进制`…
  - 规则表走现有 `safetyRules` 包贡献机制，规则可由插件扩展。
- multi-command（`;` / `&&` / 换行）任一段命中 high → 整体按 high。

---

## 六、F5 权限模型 v2（模式 / 结构化授权卡 / 持久规则）

**目标**：三档模式覆盖 Codex/ZCode 的审批光谱；授权卡能"看清楚要批什么"；批准记忆可持久化。

### 6.1 权限模式（任务记录新增 `permissionMode`）

| 模式 | 行为 | 对标 |
|---|---|---|
| `plan` | 工具面裁剪为只读集 + todo_write + plan_submit + ask_user；systemAddendum 声明规划模式 | ZCode plan mode |
| `default` | 现行 PERM 基线（本文档全部默认） | Codex 默认审批 |
| `yolo` | 除 `git_push`（恒 each-time）与 `commandRisk=high` 外全部 auto；全部动作时间线留痕 | Codex full-access / ZCode yolo |

- 入口：输入台模式 chip 切换（下一轮生效）/ `createTask({ mode })` / `/plan`、`/yolo` 命令（F10）。
- 与任务型叠加：工具面取交集（taskType.tools ∩ 模式集），权限取收紧方向——现有 `effectivePermissionClass` 机制直接复用，plan/yolo 只是两个预置 policy。

### 6.2 授权卡 v2（结构化 payload）

事件 `permission` 增加可选字段（向后兼容）：

```ts
{ type: "permission", title, detail, command, requestId,
  payload?: {
    kind: "command" | "git-stage" | "git-commit" | "git-push" | "mcp",
    paths?: string[],            // stage/写类：文件清单
    diffStat?: string,           // "+12 −3 · 3 files"
    risk?: "high" | "medium",    // commandRisk 结果
    source?: "mcp" | "plugin",   // 工具来源徽标
  } }
```

- 渲染层按 kind 渲染：命令 mono 块 / 文件列表 / diff 摘要行；risk 色条；`source` 徽标。
- **MCP / 插件工具**的授权卡必须带 server 名与参数 JSON 摘要。

### 6.3 批准记忆持久化（对标 ZCode "Always allow"）

- `settings.agents.rules: Array<{ id, tool: string, pattern: string | null, effect: "allow" | "deny", scope: "global" | { repo: string }, createdAt }>`
- 匹配顺序：**deny > allow > PERM 基线**；`pattern`：`null` = 工具全量，`prefix:xxx` 前缀匹配（terminal 匹配命令串，其余匹配参数 JSON）；`scope` 默认当前仓库。
- 授权卡新增按钮：批准 / 驳回 / **记住本会话**（现状）/ **总是允许 `<prefix>`**（写持久规则，仅 session 级工具可点）/ **总是拒绝**。
- 设置页新增"Agent 权限规则"表（列表 + 删除 + 手工添加）。

### 6.4 ask_user 工具（question 事件激活）

```ts
ask_user: input { question: string, options?: string[] }  → 事件 { type:"question", question, options, requestId }
```

- 类型族里 `question` 事件早已定义但内置循环从未使用——本次激活：挂起态用 `awaiting-input`；`agent.perm.reply` 扩展接受 `answer?: string`（自由文本）或 `optionIndex`；yolo 模式下仍可用（这是交互不是权限）。
- UI：时间线内联问题卡（选项按钮 + 输入框回自由文本）。

---

## 七、F6 改动预览与文件面板（"预览编辑的文件"）

**目标**：agent 每次写盘，人都能立刻看到 diff、能逐文件还原、能回到任意 checkpoint。这是 Gitter 对标 Codex diff 面板的杀手锏——diff 资产（DiffView / 验收台）全是现成的。

### 7.1 ChangeSet 缓存（宿主侧，每任务一份）

```ts
{ files: Map<relPath, { kind, added, deleted, binary }>, lastSync: ts }
```
- 增量：file-change 事件累积；校正：turn 边界 / checkpoint 后跑 `git diff --numstat <baselineSha>` 全量对齐。

### 7.2 RPC 增量

| RPC | 参数 | 返回 |
|---|---|---|
| `agent.task.files` | taskId | 文件列表（kind / ±行数 / binary） |
| `agent.task.diff` | taskId, path?, since?: `"baseline" \| "checkpoint:<sha>"` | unified diff（cap 256KB） |
| `agent.task.checkpoints` | taskId | 本会话 checkpoint 提交列表（`git log --grep="Gitter-Session: <taskId>"`） |
| `agent.task.restore` | taskId, target: `{ sha }` \| `{ path }` | 逐文件：`checkout <sha> -- path`；整点：`reset --hard <sha>`（仅任务 worktree） |

- `agent.task.restore` 的整点恢复走 **each-time 确认卡**（破坏性）；逐文件还原走确认对话框。

### 7.3 UI：任务详情三页签

```
┌──────────────────────────────────────────────────────────────┐
│ 任务标题  ● Working   [对话] [改动 3] [检查点 5]               │
├────────────────────────┬─────────────────────────────────────┤
│ 改动页签（文件列表）      │  DiffView（复用 kit/DiffView.tsx）   │
│  M src/main.ts  +40 −12 │  sideBySide / inline 切换（已有）     │
│  A src/new.ts   +88 −0  │                                     │
│  D old.css       +0 −55 │  工具行：[在 Changes 中打开] [复制 diff]│
│                         │         [还原此文件]                  │
├────────────────────────┴─────────────────────────────────────┤
│ 检查点页签：cp5 ✔ 摘要… 12:03 [查看该轮 diff] [恢复到此处]      │
└──────────────────────────────────────────────────────────────┘
```

- 时间线内的 file-change 事件渲染为 **diff mini 卡**：`path +N −M [查看]`，点击切到改动页签并选中该文件。
- "在 Changes 中打开" = `app.newWindow(worktreePath)` 落到现有验收台（hunk 三态 / 反馈 / repair 直投，A4 已通），补一个"送验收"一键入口按钮。

---

## 八、F7 上下文工程（压缩 / 预算 / 上下文表）

**目标**：长任务不爆上下文窗口；压缩后任务连续性不丢；用量可见可对账。

### 8.1 预算模型

- 模型档案增加 `contextWindow` 配置（默认 128000）；`budget = contextWindow − reservedOutput(8192)`。
- 估算：消息字符数 / 2.5（中英混合经验值）起步；每轮真实 usage（input tokens）回归校正系数，越用越准。
- 每轮开始前计算 `est`；宿主持有每任务 `ContextStats { estTokens, budget, breakdown: { system, messages, tools } }`。

### 8.2 自动压缩（对标 ZCode 自动 compact / Codex /compact）

- 触发：turn 开始时 `est > 0.8 × budget`。
- 动作：取最旧的消息段压缩，**保留最近 8 条消息原样**；被压段（必须按步边界切，保持 tool-call/result 配对完整）用当前模型发起一次专用 summarize 调用，提示词固定输出五段：`任务目标 / 已完成（含关键文件与决策）/ 未完成 / 用户约束与反馈 / 注意事项`。
- 产物替换为单条 user 消息：`［会话压缩摘要 · <ts>］\n...`；`compactions[]` 记账；时间线插宿主事件"上下文已压缩（N 条消息 → 摘要，xxk → yyk）"。
- 失败降级：summarize 调用失败 → 不压缩照常跑（下轮再试），绝不因压缩失败中断任务。

### 8.3 手动命令

- `/compact`：立即压缩；`/clear`：清空消息历史（保留 worktree / checkpoint / 账本），系统提示词重组，时间线插"会话已重置"。

### 8.4 注入卫生

- 工具结果兜底截断 16KB（各工具已截，此层兜底统一）。
- **system-reminder 通道**：宿主注入型 user 消息统一 `<system-reminder>` 包裹（排队消息、验收反馈到达、压缩摘要、中断补记）；系统提示词向模型解释该标签语义（对标 ZCode 同名机制）。

### 8.5 AGENTS.md 层级 + 技能注入

- 收集顺序：`~/.gitter/AGENTS.md`（全局）→ 仓库根 → 任务 worktree 根（若与仓库根不同）；各 cap 4000 字符；同名去重。
- 技能注入：PackageStore 的 skills 贡献（`skill.gitui.commit-style` 已有先例）以清单形式进系统提示词（id + 一句话描述）；`/skill <id>` 或任务型模板引用时展开正文（cap 8k）。

### 8.6 上下文表 UI

- 输入台上方细进度条：`▓▓▓▓▓▓░░░░ 62% · 41.2k / 64k tokens`；hover 分解（系统 / 历史 / 工具结果 / 预留）；>80% 琥珀、>92% 红并提示"下轮将自动压缩"。

---

## 九、F8 规划能力（todo + plan 模式）【必达】

**目标**：让 agent 在动手前先对齐方案（对标 ZCode plan mode / Codex plan 工具）；多步任务有可追踪的清单。plan 模式与 todo 是两个独立能力，可单独使用。

### 9.1 todo_write 工具（对标 ZCode TodoWrite）

```ts
todo_write: input { todos: Array<{ content: string, status: "pending" | "in_progress" | "completed" }> }  // 整体替换，≤ 20 条
```

- **整体替换语义**（非增量）：每次调用提交全量清单；校验 `in_progress` 至多 1 条，违反 → 错误文本回灌（模型自纠）。
- 事件 `{type:"todo", todos}`；持久化 journal + 任务记录 `todoState`（重启可回放）。
- UI：任务详情对话页顶部 checklist（可折叠，`in_progress` 高亮）；任务卡显示进度 `2/5`；权限 auto。
- 定位是**展示性引导**（steering），宿主不依据 todo 阻断任何执行；防腐原则：todo 与实际进度不符由 system-reminder 纠偏（连续 2 个 turn 结束时 `in_progress` 未变 → 注入提醒）。

### 9.2 plan 模式：全生命周期

**入口三处**：输入台模式 chip（plan / default / yolo，下一轮生效）、`createTask({ mode })`、`/plan` 命令。默认 default。

**工具面（物理裁剪）**：

```
plan 模式工具集 = (taskType.tools ∩ 只读集) ∪ { todo_write, plan_submit, ask_user } ∪ { task(mode 仅 explore) }
```

- 一切 fs/git 写工具与命令执行**从 ToolSet 剔除**（不是注册后拒绝）——模型调用幻觉中的写工具只会得到"未知工具"错误，杜绝"计划模式里偷偷写"；
- 大范围调研引导走 **explore 子代理**（§十联动）：主上下文留给计划本身，检索噪音隔离在子代理里。

**阶段流**：

```
plan 模式 turn 开始
  → 调研（read / glob / grep / explore 子代理 / ask_user 澄清需求）
  → plan_submit 提交计划 → 计划卡挂起（任务态 awaiting-input，无新状态机节点）
      ├─ 批准 → permissionMode → default → 计划文本注入执行轮
      └─ 继续讨论 → 追问/修改意见注入 → 仍 plan 模式 → 可再次 plan_submit（旧卡标记 superseded）
```

**plan_submit 契约**：

```ts
plan_submit: input {
  plan: string   // 结构化 markdown，模板随系统提示词下发：
                 // ## 目标 / ## 步骤（编号，每步含涉及文件与验证方式）
                 // ## 风险与回滚 / ## 待确认问题
}
```

- 事件 `{type:"plan", plan, requestId}` → 时间线插**计划卡**（markdown 渲染）；
- 计划卡动作复用授权卡回执协议 `agent.perm.reply`：`{ ok: true }` = 批准；`{ ok: false, answer: "<修改意见>" }` = 继续讨论（意见注入，F5 已扩展 answer 字段）；
- **批准后的执行衔接**（不新建任务/worktree，worktree 建任务时已存在）：permissionMode 切 default → plan 全文作为 user 消息注入 + 固定指示"先用 todo_write 把步骤落成清单，然后逐步执行，每完成一步更新状态"；
- 执行中改道：plan_submit 在执行模式不存在，模型以文本说明 + todo_write 调整；重大方向变更 → ask_user。

**边界与持久化**：

- "未交计划不结束轮"：plan 模式 turn 结束仍未调 plan_submit → 宿主注入 system-reminder（"你处于规划模式，本轮尚未提交计划"），连续 2 次后放行结束（防死循环）；
- 任务记录新增 `planHistory: Array<{ ts, plan, decision: "approved" | "revised", feedback? }>`——重启后计划卡只读回放，批准状态不丢；
- resume 后任务仍处 plan 模式（模式持久在任务记录上，徽标显示）；
- 与任务型组合：plan 集合取交集（9.2 首行公式），taskType 即使声明了写工具，plan 模式下也不可达。

**验收**：

1. 全流程：plan 模式 → 调研（含 explore 子代理）→ plan_submit → 批准 → todo 逐步执行 → 全勾 → checkpoint；
2. plan 模式下写工具/命令不可达（工具面枚举断言 + 幻觉调用得到未知工具错误）；
3. 修订链：继续讨论 → 二次 plan_submit → 旧卡折叠标记 superseded → 新卡批准；
4. 重启回放：planHistory 只读回放 + 模式徽标正确。

---

## 十、F9 子代理（task 工具）【必达】

**目标**：大范围检索/调研不污染主对话上下文；有限并行；对标 ZCode Agent 工具的"上下文隔离"核心价值。子代理预设可插拔（§十四 14.2 #6）。

### 10.1 task 工具契约

```ts
task: input {
  name: string,     // 子任务名（时间线折叠标题）
  prompt: string,   // 完整自包含任务书
  mode?: string,    // 子代理预设 id；缺省 "explore"
}
```

- `mode` 解析自 subagentPresets 贡献点（内置 explore / act，插件可贡献 review、test-runner 等）；未知 mode → 错误文本列出可用预设；
- 工具 description 明确要求：**子代理看不到父对话，prompt 必须自包含**（全部背景、文件路径、期望产出格式）。

### 10.2 并发模型（裁决：同步阻塞 + AI SDK 并行 tool-call + 信号量限流）

- **同步**：task 调用阻塞至子代理结束，final message 作为 tool result 回父——模型心智简单、结果天然回灌，不做异步任务句柄/轮询基础设施；
- **并行**：模型在一条 assistant 消息里发多个 task tool-call，AI SDK 原生并发执行，宿主以信号量限流至 **3**（`settings.agents.maxSubagents`），第 4 个排队；
- **深度 1**：子代理工具面物理剔除 task 工具（防递归）；
- **超时**：wall-clock 上限 explore 5min / act 10min（预设可配），超时 → abort → tool result 注明 `timeout` 与已完成部分。

### 10.3 子代理运行时（ChildLiveSession）

- 独立 messages：system = 内置子代理提示词（身份 + worktree 边界 + 产出格式）+ 预设 promptAddendum + 精简版仓库上下文（branch / status 摘要，不带父对话历史）；模型解析链 = 预设 modelRef → 继承父 modelRef；
- **不建 worktree、不进任务列表、不入账本**（子代理是任务内部的执行细节，不是一等任务）；共享父任务 worktree；
- 子 transcript 持久化 `.git/gitter/agent-sessions/<taskId>/subtasks/<subtaskId>.json`（调试与时间线展开回放用，独立于主历史，上限 20 个/任务）；
- usage 记账挂到父任务档案（子代理消耗对账可见）。

### 10.4 权限矩阵

| 预设 | 工具面 | 写操作 | 授权卡 |
|---|---|---|---|
| explore | 只读集（repo_* / glob / grep / read） | 无 | 不弹（全 auto 只读） |
| act | 父任务工具面 ∩ 预设 tools | 沿父任务收紧方向 | **冒泡父时间线**（requestId 前缀 `[subtask:<name>]`，卡片显示子任务名） |
| 插件预设 | tools ⊆ 父任务工具面（编译期校验） | permissionPolicy 只能收紧 | 复用 taskTypes 校验器（14.2 #6） |

### 10.5 事件与 UI

- 事件 `{type:"subtask", subtaskId, name, state: "running"|"completed"|"failed"|"timeout"|"cancelled", finalMessage?, durationMs}`；
- 父时间线：task 工具卡——running 态显示子任务名 + 时长 + spinner；完成态折叠为结果摘要，展开 = 完整 final message（markdown）+ 子时间线只读回放（子 transcript 事件重放，子授权卡显示为已决定历史）；
- `agent.tool.called` 事件对子代理工具调用同样广播（带 subtask 标，14.7）；
- todo 归父任务所有，子代理不携带也不修改。

### 10.6 中止与失败

- 父停止（Esc/停止按钮）→ 级联 abort 全部运行中子代理 → tool result 注明 `cancelled`；
- 父 turn 结束仍有未完子代理（理论不发生，同步模型下兜底）→ 取消并在父 tool result 注明；
- 子代理循环失败（provider 错误）→ 不重试（父模型拿到错误后自行决定重发 task 或换路径），与父循环的重试策略（F12.1）解耦。

### 10.7 与 plan 模式联动（§九）

- plan 模式下 task 工具仅暴露 `explore`（act 与写类预设从工具面剔除）——规划期调研零副作用；
- 批准计划切 default 后，act 及其它含写预设的预设恢复可达。

### 10.8 验收

1. "全仓库找出所有调用 X 的位置并汇总"经 explore 子代理完成，且主上下文 token 增长 < 子上下文的 20%（usage 对账可测）；
2. 3 个 explore 并行检索，结果按 tool-call 顺序分别回灌；第 4 个排队不超限；
3. act 子代理写文件 → 授权卡冒泡父时间线（带子任务名）→ 批准 → 写入成功 → file-change 进 ChangeSet；
4. 父停止级联取消子代理，tool result 注明 cancelled；
5. plan 模式下 act 不可达（工具面枚举断言）；
6. 插件自定义预设（如 review）注册后 task mode 可选，卸载后从枚举消失。

- 明确不做跨任务编排（多 agent 工作流不进 v4，见 §十九）。

---

## 十一、F10 输入台（@ 提及 / 斜杠命令 / 图片 / 排队）

### 11.1 @ 文件提及

- composer 内 `@` 触发浮层：`git ls-files` 清单 + 前缀/子串模糊匹配 + 最近打开优先，cap 50 项；选中插入 `@src/main.ts`。
- 提交时宿主展开：≤3 个且总量 ≤32KB → 文件内容以 `<system-reminder>` 附加（行号格式同 read v2）；超限 → 只附路径并提示模型自行读取。
- 另支持 `@任务名`：附该任务 lastMessage 与 ChangeSet 摘要（跨任务引用）。

### 11.2 斜杠命令（本地处理，不进模型）

`/compact` `/clear` `/plan` `/yolo` `/model <id>` `/thinking <level>` `/skill <id>` `/fork` `/stop`
- 复用现有 commands action 机制：新增 action `agent.command`，插件可贡献会话命令（进同一补全列表）。

### 11.3 图片输入

- 粘贴 / 拖拽 → 附件条（缩略图 + 移除）；发送时模型档案 `vision: true`（模型档案新增字段）→ image content part 进消息；否则 toast 拒绝并说明。
- 不做本地 OCR（见 §十八）。

### 11.4 排队投递（对标 ZCode 工作中追加输入）

- `working` / `awaiting-permission` 状态下允许输入并发送 → 进入 `queued[]`（任务记录），输入框显示"排队中 N 条"chip；授权卡不阻塞输入。
- turn 边界自动注入（`system-reminder` 前缀"用户在工作期间补充："）。
- 手动停止时不丢：queued 保留，回填输入框。

### 11.5 其他

- Esc / 停止按钮中断；`awaiting-permission` 时中断 → 拒绝全部挂起授权（防悬挂）。
- 输入历史 ↑/↓（本地最近 20 条）。

---

## 十二、F11 时间线 UI v2（工具卡）

**目标**：从"一行文本流水"升级为可审阅的操作记录（对标 Codex/ZCode 工具卡）。

### 12.1 块模型（渲染层 TimelineBlock）

`user | assistant(md，流式合并已有) | tool | permission | question | plan | todo | checkpoint | subtask | system-reminder(折叠) | log(折叠组)`

### 12.2 工具卡

- 一行：`[图标][工具名][参数摘要 mono 截断][状态点][耗时]`；点击展开：完整参数代码块 + 完整结果 pre + [复制]。
- terminal 工具运行中：尾部 4 行实时 tail（F4 流式事件驱动）；file 类工具展开显示 diff mini（F3 回执）。
- 事件升级：`tool-call` / `tool-result` 以 `toolCallId` 配对，新增事件 `{type:"tool", phase:"start"|"end", callId, name, args?, result?, durationMs, isError?}`（保留旧 status/log 事件兼容一个版本）。

### 12.3 渲染性能与回放

- 虚拟化：渲染上限 400 块 + [加载更早]（journal 分页，F1）；`log`/`debug` 折叠为一行"显示 N 条日志"。
- markdown：代码块 [复制] + 语言标签；保持 html 关闭防注入（现状不变）。

---

## 十三、F12 可靠性与扩展面（重试 / 防死循环 / 插件工具 / MCP）

### 12.1 重试与降级

- error part 分类：HTTP 429 / 5xx / timeout / ECONNRESET → 指数退避重试（1s / 4s / 16s，最多 3 次）。streamText 每步是独立请求，从失败步重试即可，已完成步不重付。
- 仍失败 → `failed`，UI [重试] = resume 空输入触发续跑。
- 模型档案失效 → 兜底链：任务型 defaultModelRef → 全局默认（现状模型链已有，补自动降级而非直接 failed）。

### 12.2 防死循环

- 同一 `(tool, argsHash)` 连续失败 3 次 → 注入 `<system-reminder>`："该操作已连续失败 N 次，请更换方法或询问用户"。
- `stepCountIs(50)` → taskType.maxSteps 可配（上限 200）。

### 12.3 插件 agentTools（对标 ZCode 插件工具）

- manifest 新增贡献点：

```json
"agentTools": [{ "id": "my-tool", "name": "…", "description": "…",
                 "path": "tools.js", "permission": "each-time" }]
```

- L2 插件入口导出 `registerAgentTool(def)` 进统一 ToolRegistry（tool-agent-fusion D 阶段落点）；`buildToolset` 并入，命名空间 `<pkg>.<id>`；默认 each-time。
- `taskTypes` 校验集合动态化 = 内置工具 + 活跃 agentTools。

### 12.4 MCP 工具入循环

- ToolRegistry 中 `source=mcp` 的工具（externalMcpEnabled 信任门已有）→ 设置 `agents.externalMcpTools`（默认 off）开启后并入循环，命名 `mcp.<server>.<tool>`；授权默认 each-time；工具卡标 `[MCP]` 徽标；server 级开关逐个放行。

---

## 十四、全插件化设计（Agent 能力面贡献点化）

> 定位：F1–F12 的能力不是宿主里的硬编码开关，而是长在 extension-system-v2 的贡献点体系上——**内置能力与第三方插件走同一批接缝**：内置功能用与插件完全相同的 API 自举注册，同槽位按同一套优先级竞争。这保证接缝不腐烂（eat your own dog food），也保证"拔掉所有内置包，agent 仍是一个（空载的）运行时"。
> 一句话原则：**数据可插件，引擎不插件**——规则、提示词、工具、渲染器全部开放；授权判定、路径锁、checkpoint 事务、权限模式裁剪是安全内核，只收不放。

### 14.0 现状接缝盘点：复用什么、补什么

| 现状 | 状态 | 处置 |
|---|---|---|
| L1 声明式贡献：taskTypes / skills / safetyRules / mcpServers / models / commands / pages / themes | 已有 | 直接复用，agent 新贡献点对齐同一 manifest 校验模式 |
| L2 `ctx.registerTool` → ToolRegistry（source=plugin） | 已有 | 成为 agent 工具面唯一事实源（14.4） |
| L2 `ctx.registerLoop` → extensions/agentLoop.ts | 已有，**但与 agents/loop.ts HARNESS_LOOPS 是两套并行循环注册表** | 合一（14.3） |
| agents/tools.ts `buildToolset`（AI SDK zod 工具，每次会话自建） | 已有，**与 ToolRegistry 完全平行** | 融合为注册表视图（14.4） |
| `composeSystemPrompt` 硬拼接 / `collectRepoContext` 写死三段 | 硬编码 | 槽位化 + 采集器可插拔（14.5） |
| 渲染层 uiRegistry 槽位-提供者模型（用户包 > 内置包 > 宿主内置） | 已有 | agent UI 贡献点沿用同款竞争语义（14.6） |
| U5 生命周期事件 `ctx.on("agent.task.*")` | 已有 | 细化为只读事件面（14.7） |

### 14.1 分层与信任模型（四级）

| 层 | 载体 | 能贡献什么 | 信任门 |
|---|---|---|---|
| **L1 声明式** | manifest JSON（无代码） | taskTypes、promptSections（静态段）、subagentPresets、agentPermissionRules、skills、safetyRules、mcpServers、models | 装包即生效；manifest 编译期校验，错误进 DTO.error |
| **L2 宿主** | 包 entry（in-process，host.ts ctx） | registerAgentTool / registerAgentLoop / registerContextCollector / registerCompactor / registerPromptSection（动态段） | 沿 uiRegistry 信任分级（内置包随分发 > 用户包审核渠道门控）；权限域复用现有 `permissions: ["tools", …]` |
| **渲染层** | 页面包模式（GITTER_UI SDK） | timelineRenderers、composerProviders（14.6） | 权限域沿页面包 permissions；markdown 沙箱不变（html 关闭） |
| **L3 沙箱** | utility process RPC（l3-child/rpcScopes 已有）+ MCP | 不可信循环/工具的远期形态 | 本版只保证接缝不焊死，不开放 |

### 14.2 贡献点总表

| # | 贡献点 | 层 | 声明方式 | 内置自举 | 竞争/命名规则 | 分册 |
|---|---|---|---|---|---|---|
| 1 | agentTools | L2 | `contributes.agentTools` + `ctx.registerAgentTool` | F2/F3/F4 全部内置工具经同一 API 注册（source="builtin"） | 命名空间 `<pkg>.<id>` 天然无冲突；taskType 白名单校验集合 = 内置 ∪ 活跃插件工具 | F12.3 |
| 2 | agentLoops | L2 | `ctx.registerLoop`（API 名保留，转发统一注册表） | `builtin.default`（AI SDK 循环）自举 | 选择链 taskType.defaultLoop → task.loopId → builtin.default；同 id 用户包覆盖内置包 | 14.3 |
| 3 | promptSections | L1+L2 | `contributes.promptSections { slot, order, content }` / `ctx.registerPromptSection` | identity / boundary / context / skills / output 五个内置段 | 槽位内按 order 追加（不竞争）；slot 枚举固定 | 14.5 |
| 4 | contextCollectors | L2 | `ctx.registerContextCollector({ id, tokenBudget, collect(wt) })` | gitStatus / agentsMd（层级化）/ topLevel 三个内置采集器 | 并列追加；各自 token 预算，超限截断该段 | F7 |
| 5 | compactors | L2 | `ctx.registerCompactor({ id, compact(messages, budget) })` | builtin.summarizer（F7 五段式） | 单选：taskType.compactor → 设置 → builtin | F7 |
| 6 | subagentPresets | L1 | `contributes.subagentPresets { id, tools, promptAddendum, permissionPolicy, maxConcurrent }` | explore / act 两个内置预设 | 并列注册；task 工具 mode 枚举 = 全部活跃预设 | F9 |
| 7 | agentPermissionRules | L1 | `contributes.agentPermissionRules { tool, pattern, effect }` | 危险命令分级表（commandRisk，F4）经同一格式 | deny > allow > 基线；同 pattern 冲突时 deny 赢 + 安装时警示 | F4/F5 |
| 8 | inputProviders | 渲染层 | `GITTER_UI.registerAgentUI({ composerProviders })` | @文件 mention（内置）；斜杠命令走 commands `action: "agent.command"` | prefix 不竞争（@ / 自定义字符）；同 prefix 用户包覆盖内置包 | F10 |
| 9 | timelineRenderers | 渲染层 | `GITTER_UI.registerAgentUI({ timelineRenderers })` | tool / permission / plan / todo / checkpoint / subtask 内置渲染器 | match 精确工具命名空间 > 通配 blockKind；rank 竞争同 uiRegistry | F11 |
| 10 | 事件面 | 宿主 | `ctx.on("agent.turn.*" / "agent.tool.*" / "agent.permission.*")` | — | 只读广播；pre-tool 拦截钩子不开放 | 14.7 |

### 14.3 循环注册表合一（裁决：消灭双循环机制）

现状：`agents/loop.ts`（HARNESS_LOOPS，AI SDK，任务卡主循环）与 `extensions/agentLoop.ts`（LOOPS，手写 HTTP 双协议，供 `agent.loop.run` RPC）是两套并行的循环注册表、两种工具调用形态。

- 唯一注册表 `AgentLoopRegistry`（agents/loops.ts），唯一契约 = 现 `LoopOptions / LoopResult`（AI SDK 形态为主契约）；
- `builtin.default` = 现 builtinLoop；extensions/agentLoop.ts 的 `builtin.tools` / `builtin.tools.anthropic` 迁移为统一注册表内的两个轻量内置循环（保留其自研 HTTP 双协议价值：命令面板 quick-ask、无 AI SDK 依赖场景），`agent.loop.run` RPC 底层改查统一注册表，对外不变；
- `ctx.registerLoop` API 名保留，内部转发统一注册表（fullId = `<pkg>.<loopId>`），**插件零改动**；
- L3 第三方沙箱循环维持封存（§15 触发条件不变）。

### 14.4 工具面单源（裁决：ToolRegistry 是唯一事实源）

现状：`agents/tools.ts buildToolset` 每个会话用 AI SDK `tool()` 现造一套，与 `extensions/tools.ts ToolRegistry` 完全平行——插件工具进不了任务卡循环，内置工具不进统一总线。

- `ToolDef` 扩展：`parametersSchema?: z.ZodType`（AI SDK tool 直接消费；缺省包一层空对象 schema）+ `permissionClass?: "auto" | "session" | "each-time"`（旧 `read | write:gate` 映射 read→auto、write:gate→each-time，保留兼容）；
- `buildToolset` 重写为**注册表视图**：`registry.list()` → 过滤（任务型白名单 ∩ 权限模式裁剪 ∩ 持久规则）→ 适配为 AI SDK ToolSet；
- 内置 12+3 个工具改为经 `registerAgentTool` 自举注册（source="builtin"），与插件同一条入表路径；
- 收益：内置 / 插件 / MCP 三来源工具在**授权卡、任务型校验、时间线渲染**三条链路自动同权同形，无需逐链特判。

### 14.5 提示词槽位与上下文采集器

- `composeSystemPrompt` 重构为**槽位组装器**：按 `identity → boundary → context → skills → addendum → output` 顺序拼接各 promptSection 贡献（内置段 + L1 静态段 + L2 动态段，order 排序）；worktree 边界声明（安全文本）锁死在 boundary 内置段，插件段无法插到它前面；
- `collectRepoContext` 拆为三个内置 contextCollector；F7 的层级 AGENTS.md、技能清单都长在采集器上；每个采集器带 `tokenBudget`（与 F7 预算联动，超限截断该段并标注）；
- 插件示例：monorepo 包图谱采集器（解析 pnpm-workspace 注入工作区结构）、测试框架探测采集器（读 package.json 注入"测试命令是 vitest"）。

### 14.6 渲染层插件契约（GITTER_UI.registerAgentUI）

```ts
GITTER_UI.registerAgentUI({
  timelineRenderers: [
    { match: { blockKind: "tool", tool: "mydeploy.release" },   // 精确命名空间优先
      component: (props: TimelineCardProps) => Element },
  ],
  composerProviders: [
    { kind: "mention", prefix: "@", label: "Issues",
      source: (query: string) => Promise<MentionItem[]> },
  ],
});
```

- `TimelineCardProps = { block, taskId, expandable }`：只读数据 + 既有 RPC 通道（卡片动作复用 `call()`）；
- 渲染约束：走 markdown / 主题 token 沙箱（html 关闭不变），禁止直接网络请求（网络类贡献一律走 L2 工具）；
- 竞争语义与 uiRegistry 完全同款：用户包 > 内置包 > 宿主缺省渲染器；包卸载 = loader cleanup 清注册。

### 14.7 事件面细化

- 已有：`agent.task.created / resumed / stopped / removed`（U5）；
- 补充（全部**只读广播**）：`agent.turn.started / completed`、`agent.tool.called`（post，含 toolName / args / durationMs / outcome，结果截断）、`agent.permission.raised / decided`；
- **pre-tool 拦截钩子不开放**：想影响工具执行只能贡献 safetyRules / agentPermissionRules 数据（L1），不能挂钩子——否则等于绕过授权卡。这是"引擎不插件"在事件面的落点。

### 14.8 安全内核（明确不插件化清单）

以下属于引擎，插件只能"收紧"不能"放宽"（taskTypes 编译期只允许收紧即该原则的现有先例）：

- 授权卡协议与判定引擎（`effectivePermissionClass` / 规则匹配顺序 deny > allow > 基线）；
- `resolveSafe` 路径锁（含 symlink realpath 校验）；
- checkpoint 事务（trailer 代打、唯一免卡写）；
- 安全网 block 档扫描时机（commit 执行体内部，插件只贡献规则）；
- `git_push` 恒 each-time；
- 权限模式裁剪（plan 模式的物理工具剔除）；
- 账本 / 会话文件格式与 journal 分段。

### 14.9 冲突、优先级与生命周期

- 命名空间类（工具 / 循环 / 命令）`<pkg>.<id>` 天然无冲突；槽位类（渲染器 / 输入提供者 / promptSection 同槽 order 相同时）用 rank 竞争（用户包 > 内置包 > 宿主缺省，同 uiRegistry）；
- 启用范围：包启停补 repo 维度（global / repo 级）；停用 = disposables 清理（host.ts 现有模式），运行中会话的 ToolSet 下轮重建生效；
- 校验：manifest 编译期校验沿用；agentTools 的 schema 缺失 / permission 非法 → 包级降级进 DTO.error，不拖累其它包；
- 规则冲突警示：同 pattern 的 allow 与 deny 并存 → 安装时警示 + deny 赢。

### 14.10 验收：吃自己狗粮

全插件化的验收不是"有 API"，而是三条可测标准：

1. **无特判**：内置 agent 能力（工具 / 循环 / 采集器 / 压缩器 / 子代理预设）全部经同一批接缝自举注册——代码里不存在绕过注册表的内置分支；
2. **拔除测试**：禁用全部 agent 相关包，宿主仍以 `builtin.default` + 空工具面跑通"对话-only"会话；逐个重新启用，能力逐档恢复（自动化为 smoke 脚本）；
3. **示例包**：`examples/` 新增 hello-agent-tool 最小包（一个 agentTool + 一条 promptSection + 一个 subagentPreset），冒烟验证注册 → 授权卡呈现 → 循环内调用 → 卸载清理全链路。

### 14.11 与路线的关系

不新增阶段，只约束交付顺序——**先接缝，后内置**：

- B2 开工前先落 14.4 工具面单源（内置读工具直接以插件同款方式注册）；
- B4 开工前先落 14.5 提示词槽位 / 采集器 / 压缩器接缝（层级 AGENTS.md 与技能注入长在采集器上）；
- B5 开工前先落 14.6 registerAgentUI 与输入提供者；
- B6 即全插件化收尾：14.3 循环注册表合一 + subagentPresets + 事件面细化 + hello-agent-tool 示例包 + 拔除测试自动化。

## 十五、RPC / 事件协议增量汇总

| 类别 | 名称 | 说明 |
|---|---|---|
| RPC | `agent.task.files` / `agent.task.diff` / `agent.task.checkpoints` / `agent.task.restore` | F6 改动预览 |
| RPC | `agent.task.setMode` | F5 权限模式切换 |
| RPC | `agent.task.queue` | F10 排队投递（或复用 resume 加 queue 标志，实施时定） |
| RPC | `agent.task.history` | 增分页参数（兼容） |
| RPC | `agent.context.stats` | F7 上下文表数据 |
| RPC | `agent.perm.reply` | 扩展 `answer` / `optionIndex`（F5 ask_user） |
| 事件 | `tool`（start/end，callId 配对） | F11 工具卡 |
| 事件 | `todo` / `plan` / `subtask` | F8 / F9 |
| 事件 | `file-change` | 扩展 `summary: "+N −M"`、kind 增 `read-image`（F2/F3） |
| 事件 | `permission` | 扩展结构化 `payload`（F5） |
| 事件 | `output`（stream:"tool"） | F4 命令流式 tail |
| 兼容 | 其余事件族 / 账本形状 | 不变 |

## 十六、Settings / manifest / i18n 增量

| 项 | 内容 |
|---|---|
| `settings.agents.rules` | 持久授权规则表（F5） |
| `settings.agents.compaction` | `"auto" \| "manual" \| "off"`（默认 auto） |
| `settings.agents.externalMcpTools` | MCP 工具入循环开关（默认 off，F12） |
| `settings.agents.maxSubagents` | 并发上限（默认 3） |
| 模型档案 | 增 `contextWindow`、`vision` 字段（F7 / F10） |
| manifest | 增 `contributes.agentTools`（F12） |
| Strings.tsv | 全部新 UI 词条（页签/卡片/按钮/浮层），沿用 en + zh-Hans 双语 |

## 十七、实施路线（B 系列）

| 阶段 | 交付 | 验收 |
|---|---|---|
| **B1 正确性底座** | F1 全部：历史回写、fork 独立 worktree、async IO、journal 分段、重试退避、工具结果兜底截断 | 三轮续跑模型能答"上一步改了哪个文件"；读大文件 UI 不卡；provider 断网重试后继续 |
| **B2 读工具面** | F2：read v2 + glob + grep + readLog；F3 错误增强 | "在全仓库找到 X 的定义并读相关文件"类任务零人工辅助完成 |
| **B3 改动预览与权限 v2** | F6 全部 + F5 授权卡 v2 / 持久规则 / plan·yolo 模式 | 改 3 个文件的任务全程可在任务页看 diff、逐文件还原、恢复 checkpoint |
| **B4 上下文工程** | F7 全部 + F3 写前读校验 | 30+ 轮会话自动压缩后任务连续；上下文表与 usage 对账误差 < 15% |
| **B5 规划与输入台** | F8 + F10 + ask_user | plan→批准→todo 全勾→完成的完整链路；工作中排队消息在轮边界生效 |
| **B6 子代理与扩展面** | F9 + F12.3/12.4 + F11 工具卡收尾 | explore 子代理检索大仓库、结果折叠回传；插件 agentTool 与 MCP 工具在授权卡可见可控 |

依赖关系：B1 是一切前置；B2→B4（写前读校验依赖 readLog）；B3 独立可并行；B5 依赖 B3 的模式开关；B6 收尾。
插件化约束（§十四）：各阶段**先接缝后内置**——B2 先落工具面单源（14.4），B4 先落提示词/采集器/压缩器接缝（14.5），B5 先落 registerAgentUI（14.6），B6 为全插件化收尾（循环注册表合一 + 拔除测试 + 示例包）。

## 十八、测试计划

- **vitest 单测**（纯函数优先，对齐 v3.0 测试约定）：权限规则匹配顺序、patch 原子性与相似度提示、CRLF 报错、glob/grep 截断与降级、压缩触发阈值与步边界切割、危险命令分级、slug/fork 派生、usage 校正系数。
- **假 provider 端到端**（脚本化 tool-call 流）：多轮历史回写重放、压缩后消息序列合法（tool 配对完整）、子代理结果回传、排队注入时机、plan 批准流转、授权卡 payload 形状。
- **插件化回归**（§十四）：注册表命名空间 / 槽位竞争 / 卸载清理单测；拔除测试自动化（禁用全部 agent 相关包跑通对话-only 会话，逐包启用逐档恢复）；hello-agent-tool 示例包全链路冒烟。
- **无头 smoke**（对齐 smoke-a4 风格）：B 每阶段一组脚本化验收项。

## 十九、明确不做（v4）

- inline 补全 / 编辑器内 chat（v3.0 §十一边界不变，agent 对话只发生在任务卡）；
- 跨任务多 agent 编排 / 工作流引擎（子代理仅单层、服务单任务）；
- 云端会话同步、模型训练、遥测上报（本地记账不变）；
- 本地 OCR（图片输入仅对多模态模型生效）；
- 非 git 目录的 agent 任务（worktree 三元组是安全模型的地基）；
- 终端完整远程仿真（逃生舱复用现有 TerminalManager，不为工具执行再造 pty 多路复用）。

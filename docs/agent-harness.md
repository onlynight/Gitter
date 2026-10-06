# Gitter Agent Harness 设计 v3.0（自身即 agent 运行时）

> 状态：设计提案 v3.0（2026-10-05），**仅设计方案，未动代码**；本版**推翻 v2.0 的方向性误读**并给出裁决
> **实施进度（2026-10-06）：A1–A4 全部落地**——A4 验收台闭环补齐（review_get_state 工具 / 验收台 rejected 直投修复轮 review.repair + pickRepairTarget 选择器 / git.push EachTime 先行 / Log 会话卡「打开任务卡」联动 focusTaskId），无头验收 `node dist/smoke-a4.js`（12 项）
> **Markdown 输出（2026-10-06）**：agent 文本输出在任务时间线按 markdown 渲染（markdown-it，CommonMark+linkify+breaks，html 关闭防注入；流式增量合并为一块渲染）；插件可扩展：渲染层 `registerMarkdownPlugin` 注册任意 markdown-it 插件（web/src/lib/markdown.ts）；输出内链接点击经 `shell.openExternal` 交系统浏览器（http/https 白名单）
> **任务历史持久化与读取（2026-10-06）**：会话文件升级为 消息历史 + 事件日志（journal，上限 500 条，人类动作记 text、循环/宿主事件记 event）；`agent.task.history` RPC 返回 记录 + 日志 + 消息（UI 回填时间线 + 插件读取面，主进程插件可直接调 SessionManager.taskHistory，MCP 工具面后续接入）；任务页选中任务时从盘上回放时间线，Gitter 重启不丢历史
> 裁决：Gitter 不是去适配外部 agent CLI（codex exec 等）——**Gitter 自身做成 agent harness**，即 ZCode CLI / DeepSeek Harness 这类工具的同构物：内嵌 LLM 工具循环 + 工具集 + 权限门 + 会话管理，宿主在自己的 GUI 里
> 关系：本方案是 extension-system-v2.md **§十五（Agent 主循环开放 / P4.5）的完整化**——§15 定了循环选型与安全不变量，本方案补齐工具集、会话模型、任务卡宿主壳与 UI 规格；ai-native-redesign.md §12.4 的事件模型沿用，"宿主外部 CLI"降级为后续可选扩展点
> UI 规格：docs/gitter-fused-preview.html（可点击原型，2026-10-05 已确认）——任务页为**两栏布局**（左任务卡列 / 右会话详情），当前实现的卡片栅格不符合，需按 §七重构

---

## 一、定位裁决：什么叫"把自己做成 agent harness"

### 1.1 三家同构对照

| | ZCode CLI | DeepSeek Harness | **Gitter Harness（本方案）** |
|---|---|---|---|
| 循环 | LLM 多步工具循环（CLI 内） | LLM 多步工具循环 | LLM 多步工具循环（**Electron 主进程，L2**） |
| 模型 | 自家/配置端点 | 自家 | **provider 接缝**：openai-compatible（DeepSeek/Ollama/任意端点）/ anthropic（用户自配，本地优先） |
| 工具 | read/write/edit/bash… | 文件/命令/检索… | **Gitter 的 git 事务面**：status/diff/log/读文件/**写文件/patch**/stage/commit + worktree + 终端命令 + review.state |
| 权限 | 权限模式/逐次确认 | 审批/沙箱 | **分级授权卡**：只读 auto、worktree 内写 auto、git 写=Session 记忆、远端/历史=EachTime |
| 会话 | 会话恢复/流式 | 会话/流式 | 会话持久化 + 流式时间线 + resume + 退回重做 |
| 宿主形态 | 终端 TUI | CLI/GUI | **GUI 任务卡**（worktree 隔离 + 会话基线 + 验收台直通） |

**Gitter 的差异化不在循环（循环是通用件），在工具面与验收台**：别人家的 harness 改完代码给用户一个 diff；Gitter 的 agent 干完活直接落在验收台——hunk 三态、风险信号、会话基线 diff、checkpoint 时间线全是现成资产。**这就是"AI 生产，人验收，Gitter 管理验收台"的完整闭环。**

### 1.2 推翻与继承

| v2.0（废止的方向） | v3.0（本版） |
|---|---|
| harness = 适配外部 agent CLI（codex exec --json） | harness = **Gitter 自有 agent 运行时**；外部 CLI 降级为 P3 可选"外部桥"扩展点 |
| catalog/detect/LaunchSpec/事件映射（解析外部协议） | **不需要**——循环、工具、事件都产自宿主自身；该机制封存不删（未来接外部桥可复活） |
| cli-json 传输 + codex 包 manifest | 封存（处置见 §八） |
| 事件模型 / 任务账本 / 托管 checkpoint / prompts / safety 门 / 任务卡 RPC 形状 | **全部继承**——只是事件的生产者从"外部进程"换成"自家循环" |
| §15 agentLoop（ctx.registerAgentLoop，Vercel AI SDK） | **即本方案的核心**：§15 定选型与不变量，本方案给完整系统设计 |

---

## 二、总体架构

```
┌────────────────────────── Electron 主进程（L2，循环执行权不出宿主）────────────────────────┐
│                                                                                           │
│  AgentLoop（Vercel AI SDK streamText + tools + maxSteps）                                  │
│    │ 决策：下一步调哪个工具（流式 text/tool-call 增量）                                      │
│    │                                                                                       │
│  AgentToolset（工具面操作目录的 zod 化，tool-agent-fusion.md §三）                           │
│    ├─ 只读工具：repo.status / repo.diff / repo.log / repo.read_file / repo.list_files      │
│    ├─ 写工具（worktree 内 auto）：file.write / file.patch                                  │
│    ├─ git 写（授权卡 Session 记忆）：git.stage / git.commit（内置安全网 + trailer 代打）     │
│    ├─ 命令（授权卡 Session 记忆）：terminal.run（cwd=worktree，输出回灌）                    │
│    └─ 远端/历史（授权卡 EachTime）：git.push / git.reset …（v1 可先只留 push）              │
│    │ 执行：git 服务层 + fs（路径校验锁 worktree）+ TerminalManager；写一律过 safety.ts 人审门│
│    │                                                                                       │
│  AgentSession（会话状态机 + 消息历史持久化 + 授权暂停/回执 + turn 边界 checkpoint）           │
│    │ 事件流（沿用已实现事件族：status/output/file-change/checkpoint/turn-completed/         │
│    │       permission/completed/log）——经 preload bridge 扇出渲染层                         │
├──────────────────────── preload bridge（现有，不变）────────────────────────────────────────┤
│  web/ 渲染层：任务页两栏布局（§七，按设计稿重构）                                            │
│    左：任务卡列（状态徽标/harness 标/±行数/checkpoint 计数/授权预览）                        │
│    右：详情（标题行/三色时间线/授权卡/逃生舱终端/续跑-反馈输入）                             │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

**安全不变量**（继承 §15，表述不变）："**决策可下放，执行不下放**"。v3 里循环就在宿主 L2，天然满足；工具执行全部经 safety.ts 人审门与分级授权；L3 第三方循环（未来）经 comlink 请求宿主代理执行，同样碰不到执行器。

---

## 三、AgentLoop 运行时

### 3.1 依赖（新增 npm）

| 包 | 用途 |
|---|---|
| `ai`（Vercel AI SDK） | streamText 多步工具循环、流式增量、工具调用协议 |
| `@ai-sdk/openai-compatible` | DeepSeek / Ollama / 任意 OpenAI 兼容端点（用户自配 endpoint+key） |
| `@ai-sdk/anthropic` | Anthropic 端点 |

现有 `ai.ts` 的一次性补全（provider 三分支 + safeStorage 密钥）重构为 §15 的 provider 注册表形态：`registerProvider(name, ...)`，内置两个自举；**cli 桥不进循环**（一次性补全保留用于提交消息等轻用途）。

### 3.2 循环

- `streamText({ model, messages, tools, maxSteps: 50 })`：模型决定调哪个工具；工具结果回灌直至模型产出最终文本（一轮 = 一次用户输入到最终答复）
- **系统提示词组装**（每轮注入，纯函数可测）：仓库上下文（当前分支 / status 摘要 / 顶层目录树 / AGENTS.md 若有）+ worktree 边界声明 + 输出约定（简短总结将作为任务卡摘要）+ 工具使用守则
- **流式事件**：text-delta → `agent.output`（assistant 流）；tool-call → 时间线 `status`（"调用 git.diff …"）+ 执行 → 结果摘要；每步 finish 累计 usage → `turn-completed`
- **中断**：AbortController（任务卡"停止"）——循环停，消息历史保留（续跑=带历史再跑）
- **模型缺失/调用失败**：任务卡 `failed` + 明确原因（未配置端点 → 引导设置页），无 AI 兜底原则不变

### 3.3 会话状态机

```
starting → working ⇄ awaiting-permission（写工具授权卡挂起）
         → awaiting-input（一轮完成，等下一条输入）→ working（续跑/反馈）
         → completed / failed（异常或用户放弃）/ stopped（人为停止）
```

消息历史持久化：`<repo>/.git/gitter/agent-sessions/<taskId>.json`（messages + usage + 状态）；任务索引沿用 `.git/gitter/agent-tasks.json` 账本。resume = 历史重放进 streamText（多轮对话原生支持，无需外部会话号——**v2.0 的 externalSessionId 概念作废**）。

---

## 四、工具集（操作目录的 zod 化）——本方案的实质

把 tool-agent-fusion.md §三的操作目录暴露为 LLM 工具（zod 参数 schema，与 manifest 校验同件）。**这是"Gitter 变成 harness"的实质：agent 的手就是 Gitter 的工具面。**

| 工具 | 参数（zod） | 执行 | 权限 |
|---|---|---|---|
| `repo.status` | — | git status 结构化 | auto |
| `repo.diff` | path? / staged? / baseline? | git diff（支持 vs 会话基线） | auto |
| `repo.log` | query? / limit? | git log | auto |
| `repo.read_file` | path | worktree 内读文件（路径校验） | auto |
| `repo.list_files` | dir? / glob? | 目录树 | auto |
| `file.write` | path / content | 整文件写（路径锁 worktree） | **auto**（worktree 隔离即沙箱） |
| `file.patch` | path / hunk（旧串→新串） | 定点编辑 | **auto** |
| `git.stage` | paths[] | git add | **授权卡 · Session** |
| `git.commit` | message | 安全网扫描（block 档拦截）→ 提交 + trailer 代打（Assisted-by: gitter-agent · Gitter-Session: taskId） | **授权卡 · Session** |
| `terminal.run` | command | cwd=worktree 起进程，stdout/stderr 回灌（超时 120s，输出截断） | **授权卡 · Session**（命令文本进卡） |
| `git.push` | — | push 当前任务分支 | **授权卡 · EachTime** |
| `review.get_state` | — | hunk 三态 + 反馈（人裁决 → agent 输入，tool-agent-fusion §5.2） | auto |

- 路径校验：所有 fs 工具 resolve 后必须落在任务 worktree 内（`path.relative` 前缀检查），越权 = 工具错误返回给模型（模型自纠），宿主侧同时记 warn 日志；
- 授权卡挂起 = 循环 await 一个 deferred（requestId 协议沿用已实现），批准 → 工具继续执行，驳回 → 工具返回"用户拒绝"给模型（模型调整方案，不崩会话）；
- 安全网：`git.commit` 执行体内部先跑 `safety.scan`（block 档命中 → 工具返回拦截原因，模型自行清理后重试——与 mcp.ts 人审门同语义）。

---

## 五、会话与任务卡（三元组沿用）

任务卡 = **worktree + Gitter agent 会话 + 会话基线**（不变）：

- 新建任务：建 worktree（`task/<slug>`，复用 worktrees.ts）→ 记 baselineSha → 注入系统提示词 → 首轮用户输入进循环；
- **turn 边界托管 checkpoint**（沿用已实现 checkpoint.ts）：一轮结束自动代打 WIP 提交（trailer：`Assisted-by: gitter-agent` / `Gitter-Session: <taskId>`）——会话时间线与 §5 会话卡数据源成立；
- **退回重做**：验收台 rejected hunk + 反馈文本 → 组装 user 消息（"审查反馈：只处理这些条目…"）注入同一会话续跑——NextTurn 语义天然成立，无需外部 resume 机制；
- 续跑按钮 = 带历史追加输入；时间线（三色：人/agent/宿主）由事件流驱动，**持久事实只落账本**（lastMessage / checkpoint 提交 / usage），原始消息历史落 session 文件。

---

## 六、权限模型（授权卡，按设计稿）

| 级别 | 工具 | 行为 |
|---|---|---|
| auto | 只读 + worktree 内文件写 | 直执行，时间线可见 |
| Session（本会话记住） | git.stage / git.commit / terminal.run | 首次弹内联授权卡（工具名+参数摘要+批准/驳回/记住），批准后本任务会话内不再询问 |
| EachTime（永不记忆） | git.push / reset 类 | 每次授权卡，**无"记住"按钮** |

- 授权卡挂起时任务态 `awaiting-permission`（琥珀徽标）；不抢焦点，卡在时间线内联（设计稿形态）；
- `safetyNet=block` 的提交拦截独立于授权卡（先扫后执行）；
- 复用已实现的 requestId + `agent.perm.reply` 协议，渲染层零新协议。

---

## 七、任务卡 UI（按设计稿重构，本节为前端改造规格）

**基准**：docs/gitter-fused-preview.html 任务页（已确认的设计稿）。当前实现的卡片栅格布局**不符**，按以下规格重构 `web/src/pages/TasksPage.tsx`：

1. **两栏布局**：左列 400px 任务卡列表（可滚动）；右侧详情面板（选中任务）——CSS grid `400px 1fr`，窄屏退化为单列；
2. **左列任务卡**（设计稿形态）：标题 + 状态徽标（● Working 绿脉冲 / 待确认 琥珀 / Completed 青）；第二行 harness 标（`⚡ Gitter Agent`）+ 分支名；第三行 worktree 路径（mono 小字）；第四行 `+N −N · N 文件改动中 · checkpoint ×N · 活跃 Xm`；底部动作钮（会话 diff / 打开终端 / 停止 或 续跑）；有挂起授权时卡内嵌授权预览条（命令文本 + 批准/驳回）；
3. **右侧详情**：
   - 标题行：任务标题 + 状态徽标 + `session <id> · resume ✓`；
   - **会话时间线**（核心）：三色事件流（人=绿 / agent=紫 / 宿主=青，图例同设计稿）——任务下发（含注入的系统提示词字数）、file-change ×N、tool-call（git.diff…）、命令执行及结果、宿主托管 checkpoint（带双 trailer chip）、退回重做、turn.completed（用量）；
   - **授权卡**：琥珀虚线框，`◈ 授权请求` + 操作目录 tag（如 `repo.remote.write · EachTime`）+ 命令 mono 行 + 批准/驳回 + 右侧说明（"EachTime：每次确认，永不记忆"）；
   - **逃生舱**：worktree 内嵌终端（TerminalManager 已支持多会话与 cwd，直连即可）；
   - **输入区**：时间线底部常驻输入框（续跑/反馈共用，等价设计稿的对话框入口）；
4. **新建任务对话框**：harness 选择（v1 只列"Gitter Agent"一项 + 模型配置状态提示，未配置端点 → 引导设置页）、任务名、任务描述（多行）；
5. 状态栏（页脚）沿用设计稿：watcher / GitWorker 队列 / audit 行数 / MCP server。

未在 v1 范围：命令面板 `@任务` 分类增强、多窗口双击、任务卡 diff 跳转（链接位保留）。

---

## 八、既有代码处置清单（v2.0 偏差实现的去留）

| 处置 | 文件/部分 | 说明 |
|---|---|---|
| **保留复用** | agents/types.ts（事件族/账本记录）、tasks.ts（账本）、checkpoint.ts、prompts.ts、TasksPage 的 RPC 调用与授权卡协议、bridge 六个 `agent.*` RPC 形状、settings 字段、Strings.tsv 词条 | 与方向无关的底座 |
| **改造** | agents/session.ts：外部进程监督 → **自有循环驱动**（事件生产者换源，接口不变） | 状态机/授权挂起/落账逻辑保留 |
| **封存（不删）** | agents/catalog.ts、events.ts（声明式映射求值器）、transports/clijson.ts、内置 codex 包的 harnesses 段 | "外部桥"扩展点（P3 可选）：未来接非 ACP 外部 agent 时复活；codex 包降级为普通扩展包（仅 commands/configuration 贡献）或整体下架，二选一由实施时定 |
| **新增** | agents/loop.ts（AI SDK 循环）、agents/tools.ts（zod 工具集 + 执行器 + 路径校验）、agents/prompts.ts 增系统提示词组装、ai.ts provider 注册表化、package.json 三依赖 | §四/§三 |
| **重构** | web/src/pages/TasksPage.tsx：卡片栅格 → 两栏布局（§七） | 按设计稿 |

---

## 九、安全模型（不变量全部继承）

1. **本地优先**：模型端点/密钥用户自配（openai-compatible 覆盖本地 Ollama/DeepSeek），密钥 safeStorage 加密（已有 `settings.setAiKey`），Gitter 不托管；
2. **人保留 git 写路径最终决定权**：commit/push 过授权卡；commit 内置安全网（block 档）；托管 checkpoint 是唯一免卡写——但它只产生 WIP 提交、可整体关闭、最终历史必经人确认的 squash/合并；
3. **worktree 隔离**：agent 的 fs/命令活动面锁任务 worktree（路径校验 + cwd），主 worktree 永不被 agent 触碰；
4. **AI 输出零 git 污染**：消息历史落 `.git/gitter/`（非版本控制），trailer 白名单之外不写 git 数据；
5. **降级为零依赖**：不配模型端点 → 任务卡仍可手动建 worktree/开终端派活（v1 形态保留），harness 是增强不是前置。

---

## 十、路线（A 系列，替代 v2.0 C 系列）

| 阶段 | 交付 | 验收 |
|---|---|---|
| **A1 循环跑通** | 三依赖接入 + provider 注册表化 + loop.ts（streamText 流式）+ tools.ts 只读工具 + 会话事件流/持久化 | 任务卡输入"分析这个仓库的 X"→ 流式时间线输出分析报告；停止/续跑可用 |
| **A2 写闭环** | file.write/patch + git.stage/commit（授权卡+安全网+trailer）+ checkpoint 挂接 turn 边界 | 输入改码任务 → agent 改文件 → 授权卡批准 → 提交 → checkpoint 出现在时间线与会话卡 |
| **A3 UI 按设计稿重构** | TasksPage 两栏布局 + 时间线三色 + 授权卡 + 逃生舱终端 + 输入区 + terminal.run 工具 | 与 gitter-fused-preview.html 逐项对齐；命令执行有授权卡（Session 记忆） |
| **A4 验收台闭环** ✅ 已实施（2026-10-06） | review_get_state 工具（PERM auto，读 feedback.json 两态）+ 验收台直投（Changes 反馈横幅「直投修复轮」→ review.repair RPC → pickRepairTarget 选目标任务 → sendFeedback 注入修复轮 + 清反馈）+ git.push（EachTime，先行就位）+ Log 会话卡联动（「打开任务卡」→ focusTaskId → TasksPage 选中） | 验收 = smoke-a4 12 项全绿（review_get_state 两态/auto 直行/优先级与忙态归档排除/最近活跃/clearFeedback） |

测试：prompts/工具路径校验/状态机纯函数 vitest 化（或沿用 smoke 无头模式）；循环用假 provider（脚本化 tool-call 流）做端到端；授权挂起/回执表驱动；安全网拦截回归（已有 safety.ts 用例语义）。

---

## 十一、明确不做

- 不做 inline 补全 / 编辑器内 chat（§九边界不变）——harness 的对话只发生在任务卡；
- 不做子代理/plan 模式/多 agent 编排（单循环单任务；ZCode 的子代理等成熟后再议）；
- v1 不做循环贡献点开放（`ctx.registerAgentLoop` 的 L3 第三方循环按 §15 触发条件启动）；
- 外部 CLI 桥（codex exec 等）不在主线——catalog/manifest 机制封存待需；
- 不自研模型传输（provider 接缝外的传输不做）；不做云端会话同步。

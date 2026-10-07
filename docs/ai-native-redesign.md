# Gitter 核心功能重设计：AI 编程时代的 Git 验收台

> 状态：设计 v1.4（2026-10-05）——v1.1 新增 §十二 Agent Harness 扩展框架（`harness` kind + 四级传输 + 预留接口），原 §7.4 反向桥被其吸收；v1.2 按 docs/agent-harness-codex.md 扩展 §12.3/§12.4（含 §12.9 宿主托管 checkpoint 与会话账本）。**P0–P5 主路线与顺延项已全部实现**（2026-10-05：P0/P1 见 §十三；P2–P5 见 §十四；顺延项见 §十五），harness H 系列接口已冻结、生态待建；v1.3 随插件系统 v2 与 Web 栈演进重排接口落点（C# 冻结接口为形状基准，Web 栈落点 app/src/services/agents）；**v1.4 方向裁决：Gitter 自身做成 agent harness（ZCode/DeepSeek Harness 同构，自有 LLM 工具循环），"宿主外部 CLI"降为可选外部桥——权威设计见 docs/agent-harness.md v3.0**；§12.4 事件模型与 §12.9 托管 checkpoint 概念由 v3.0 继承
> 定位输入：Gitter 是代码管理工具（git 代码管理器），辅助代码编写，**不是普通 IDE**
> 前置阅读：docs/design.md（总设计定稿）、docs/known-issues.md（技术债台账）、docs/extension-package-framework.md（.gpk 框架）

---

## 一、为什么要重设计：AI 编程改变了 git 的角色

2026 年的开发现实是：大量代码由 AI agent（Claude Code、Codex CLI、Cursor agent 等）直接在本地仓库产出，人的角色从"写代码"转向"出题 + 验收"。这带来五个结构性变化，每一条都落在 git 的事务面上——恰好是 Gitter 的主场：

| # | 变化 | 对 git 客户端的含义 |
|---|---|---|
| 1 | **代码生产者从人变成 agent** | diff 的"作者"不再都是人，需要溯源（哪些改动来自哪个 agent 会话） |
| 2 | **commit 语义变了**：agent 用 commit 做 checkpoint | 历史被大量细碎、机械的 checkpoint 提交污染，需要"会话"维度的聚合视图与整理能力 |
| 3 | **审查成为瓶颈**：产出翻倍，人审 diff 的速度没变 | 客户端的职责从"帮你写"变成"帮你快速可信地验收"——diff 审查台是核心资产 |
| 4 | **worktree 成为 AI 并行任务的标准隔离单元** | 每个任务一个 worktree + 一个常驻 agent，需要任务卡式的编排视图 |
| 5 | **git 成为人机之间的通信协议** | agent 提交、人审查回退；agent 需要 git 能力的结构化出口（MCP），人需要 agent 动作的实时可见性 |

**Gitter 的站位**：IDE 里的 AI（补全、inline chat）负责"写的时候"；Gitter 负责"写完之后、提交前后"的整个 git 事务面。Gitter 既有三大资产恰好是 AI 工作流的验收现场：

1. **自绘 DiffCanvas + 语法高亮框架**（并排/内联、字级 diff、hunk 多选）——目前全链路已实现（docs/code-highlight-framework.md P1/P2 ✅）；
2. **完整 git 能力层**（libgit2sharp 读 + git CLI 写，hunk 级暂存、变基/合并/影响面分析）；
3. **内嵌终端**（ConPTY + winpty 双后端，agent 常驻运行处）。

### 1.1 定位宣言

> **AI 生产，人验收，Gitter 管理验收台。**
> Gitter 不写代码——它让"接受 AI 写的代码"这件事变得快速、可信、可回退。

### 1.2 三条不变的原则

1. **本地优先、无云**：所有 AI 能力走用户自配的端点（本地模型或用户自己的 API），Gitter 不托管 key、不上传代码。
2. **人保留 git 写路径的最终决定权**：AI 参与的一切写动作（生成提交信息、整理提交、执行审查建议）必经人工确认；无确认不落盘。
3. **AI 可用性降级为零依赖**：每个 AI 功能必须有纯规则兜底形态——AI 不可用时 Gitter 仍是完整的 git 客户端（延续仓库现有工程风格：规则引擎纯函数化、可测试）。

---

## 二、现有基础盘点（本方案的地基）

| 资产 | 状态 | 在本方案中的角色 |
|---|---|---|
| 六页签框架（项目/Log/变更/分支/终端/设置）+ 命令面板 v2 | ✅ 已实现 | AI 功能挂载的 UI 骨架 |
| DiffCanvas：并排/内联、字级 diff、语法 run、hunk 多选、批量暂存 | ✅ 已实现 | 验收台（§三）的渲染底座 |
| 高亮框架：声明式 + Jint 脚本宿主（.gpk syntax kind） | ✅ 已实现 | 风险信号按语言识别的元数据来源 |
| .gpk 扩展框架：manifest / 按 kind 启停 / 用户包 / Jint 沙箱 | ✅ 已实现 | 新增 `policy` / `ai` kind 的载体 |
| 主题框架：语义令牌 + Diff/Terminal/Syntax 旁路配色 | ✅ 已实现 | 新增 AI 语义令牌（批注色/活动色/风险色） |
| 内嵌终端：ConPTY/winpty、VT 状态机、跟随仓库 | ✅ 已实现 | agent 活动感知（§七）的信号源 |
| hunk 级暂存/撤销（`apply --cached`）、提交影响面（`BranchDeleteImpact`） | ✅ 已实现 | 审查动作（接受/拒绝）已有一半 |
| GitWorker 单 worker 队列 | 代码已有、**未接线** | 实时基座（§七）的执行引擎 |
| FileSystemWatcher / 后台 fetch / 焦点轮询 | ❌ 仅 design §5.2 规划 | 实时基座的欠账，本方案 P0 |
| worktree / fetch / reset / cherry-pick / tag / stash | ❌ 未实现 | 并行工作台（§六）的前置 git 能力 |
| 任何 AI 相关代码 | ❌ 零命中 | 本方案的空白区，从零设计 |

---

## 三、功能域 A：AI 验收台（Review Bench）—— 旗舰功能

**问题**：审查是 AI 编程时代的瓶颈。人面对的是"agent 刚改了 14 个文件"，需要快速回答三个问题：改了什么、有什么风险、哪些接受哪些退回。

### 3.1 会话基线 diff

现状 diff 对象是"工作区 vs HEAD"或"任意两提交"。AI 场景下最常见的提问是：**"这轮 agent 会话总共改了什么？"**——agent 可能已经打了 20 个 checkpoint 提交，逐个看不成立。

- Diff 基线选择器升级为四类：`HEAD` / `工作区` / `任意提交或分支`（已有钉住比较）/ `会话起点`（见 §5.2，自动记忆每个 agent 会话的起点 commit）。
- 变更页新增默认视图"自 agent 开始以来"：工作区 + 会话 checkpoint 提交合并为一个净 diff（对会话起点做 diff，等价于 squash 视角），文件列表按影响面排序。

### 3.2 变更溯源标注（Provenance）

每个文件/每个 commit 标注来源，**只依据可信元数据，不做猜测**：

- 提交侧：author email、`Co-Authored-By:`、AI 署名 trailer（`Assisted-by: <agent-id>`，§5.2 规范）、message 模式（checkpoint 风格）；
- 工作区未提交侧（v2）：文件变更时间窗 + 终端 agent 活动时间窗做关联标注（标注为"疑似 agent 期间变更"，明确弱于提交级标注）；
- 渲染：DiffCanvas 文件头/行号槽新增来源徽标（复用现有覆盖层绘制与主题令牌 Chip 系列）。

### 3.3 风险信号面板（Risk Signals，纯规则、零 AI 依赖）

规则引擎扫描当前 diff，在文件列表与画布上叠加风险标注。首发规则（AI 编程高频事故清单）：

| 规则 | 说明 |
|---|---|
| secrets 泄露 | 密钥/token/私钥/连接串模式（复用 §4.2 安全网同一规则库） |
| 测试弱化 | 删除/跳过测试文件、删除断言行、`skip`/`pending` 增加 |
| 供应链面扩大 | 改动依赖清单/锁文件/CI 配置 |
| 大比例删除 | 删除行占比超阈值（默认 70%）的文件 |
| 顺手重构 | 单文件内与本次任务主题无关的改动面积（v2，需会话主题） |
| 占位符残留 | `TODO`/`FIXME`/`not implemented`/mock 替换真实现的常见模式 |

- 规则作为 **.gpk 新 kind `policy`** 发布（声明式 JSON 规则 + 可选 JS 高级规则，走既有 Jint 沙箱），内置一套基础规则包；
- 点击风险标注跳转到对应 hunk，并可直接发起"退回重做"（§3.4）。

### 3.4 hunk 级审查动作闭环

现状已有"暂存此块/撤销此块"（多选批量）。扩展为审查三态：

1. **接受** = 现有 hunk 暂存（✅ 已有能力）；
2. **拒绝** = 对该 hunk 做 reverse apply（写路径已有 `ApplyIndexPatch` 反向形态，需补工作区侧）；
3. **退回重做** = 选中 hunk + 批注 → 生成一条结构化反馈 prompt（"这个 hunk 存在 X 问题，请只修改 Y，不要动 Z"），v1 复制到剪贴板（用户粘回任意 agent），v2 经 agent 桥直投（§7.4）。

> 这一动作是"辅助代码编写"定位的落点：**人发现问题时不必自己改代码，而是把修改要求精确地递回给 agent。**

### 3.5 AI 解释批注层

- 入口：选中 hunk / 文件 / 整个变更集 → "解释这次改动" / "指出风险"；
- 走 `IAiGateway`（§8.1），结果以**右侧批注栏**叠加在 DiffCanvas 旁（不弹模态、不阻塞审查流），批注条目可一键转为"退回重做"的 prompt 素材；
- 生成的解释与批注**只存在于会话内存**，不写入仓库、不自动传播——避免 AI 输出污染 git 数据。

---

## 四、功能域 B：提交事务（Commit Transactions）

### 4.1 AI 提交信息生成（本地优先、必经确认）

- 输入：staged diff + 仓库风格样本；输出：conventional commits 风格 message 草稿，填入现有提交输入框，**必经人工编辑/确认**（原则 1.2-2）；
- **风格学习**：取本仓库最近 20~50 条人写 message 做 few-shot，保持仓库既有语言/格式（中英文、scope 习惯、是否带 body）；
- provider 走 `IAiGateway`：Ollama（本地）/ 任意 OpenAI 兼容端点 / Anthropic / **命令行桥**（把 prompt 管道给用户自配的 CLI，如 `claude -p`，零 SDK 依赖）；
- 生成的提交自动追加 trailer `Assisted-by: <provider-id>`（可关，§5.2）。

### 4.2 提交前安全网（内置检查器，非 git hook）

- 时机：点击提交时在 Gitter 进程内执行 staged 内容扫描（不走 git hooks，避免与用户已有 hooks 冲突；后续提供"导出为 hook"选项）；
- 规则库与 §3.3 同源（secrets/大文件/二进制误入/调试输出残留 `console.log`/`print`/`dbg!` 等，按扩展名路由到 syntax/highlighter 元数据）；
- 三档配置：阻止 / 警告 / 关闭；命中项列出文件+行+规则，可逐项豁免（本仓库豁免清单存设置）。

### 4.3 会话整理（Session Squash）

- 把一段 agent checkpoint 提交流（连续、同 `Assisted-by`/session-id，§5.2 识别）合并为一个语义提交：聚合 message 由 AI 生成或规则模板兜底（"agent X：实现 Y，涉及 N 文件"）；
- 交互入口：Log 页会话卡片右键 → "整理为一次提交"（soft reset + 重新提交，原提交链保留在 reflog，卡片区显示回退指引）；
- 解决"历史被 checkpoint 污染"：checkpoint 留给过程可见性，squash 留给最终历史。

---

## 五、功能域 C：会话感知历史（Session-aware History）

### 5.1 Log 页新增"会话"聚合层

- 识别：连续提交满足（同 author/trailer agent-id + 时间窗邻近 + message 匹配 checkpoint 模式）即聚合为一张 **agent 会话卡**：agent 名、时段、提交数、净变更量、涉及文件数；
- 折叠态占一行（与现有按天分组折叠同交互），展开看 checkpoint 时间线；人写提交不聚合、不折叠；
- 纯本地识别，规则函数化进 GitUI.Core，可测试（延续仓库黄金用例风格）。

### 5.2 会话元数据规范（Gitter 推动的开放约定）

- 提交 trailer 约定（Gitter 自身功能带头打，第三方 agent 可选遵循）：
  - `Assisted-by: <agent-id>`（AI 参与署名，与 git 社区 AI 署名方向一致）；
  - `Gitter-Session: <uuid>`（同一次 agent 会话的 checkpoint 归组键，会话起点 commit 也据此回溯）；
- 识别优先级：trailer > author + 时间窗启发（仅标注"疑似"）；
- Log 过滤语法扩展：`is:ai`、`agent:<id>`、`session:<uuid>`（并入现有 LogFilterParser）。

### 5.3 会话对比

- 既有"钉住比较基准"升级：支持选两个 agent 会话（或两个任务 worktree 分支）做净 diff——回答"两个 agent 方案差在哪"。

---

## 六、功能域 D：并行工作台（Worktree Orchestration）

**背景**：worktree 是 AI 并行任务的标准隔离单元（一个任务 = 一个 worktree + 一个常驻 agent）。当前 Gitter 完全未实现 worktree。

### 6.1 前置 git 能力补齐

`IRepositoryService` 新增：`GetWorktrees` / `CreateWorktree` / `RemoveWorktree` / `PruneWorktrees`（git CLI 实现）；连带补齐已知欠账：`Fetch`、`CherryPick`、`ResetTo`、`Tag`、`Stash`（docs/known-issues.md §三）。

### 6.2 任务卡视图

- 导航新增"任务"页签（或分支页顶部分区）：每个 worktree 一张卡——
  - 分支名（`task/<slug>` 命名模板）、状态（干净 / 变更 N 文件 / 冲突 / agent 工作中）、ahead/behind、最近活动时间、关联终端会话存活指示；
- 快速动作：**新建任务**（从默认分支拉出 worktree + 可选同时开终端）、打开终端（cwd 定位到该 worktree，复用现有跟随机制）、在编辑器打开、查看该任务净 diff（§3.1 会话基线）、合并回主分支、清理已合并任务（`BranchDeleteImpact` 影响面确认，复用现有危险操作确认交互）；
- 双击任务卡 = 多窗口打开该 worktree（多窗口机制已实现，天然衔接）。

### 6.3 多终端会话

- 终端页从单会话升级为 tab 容器：每个任务一个终端 tab；会话层（ConPTY/winpty）已支持多实例，此为纯 UI 编排工作；
- agent 活动指示（§7.3）逐 tab 呈现。

---

## 七、功能域 E：Agent 桥与实时感知（Gitter 作为 AI 基础设施）

### 7.1 实时基座（P0，无 AI 也受益）

偿还 design §5.2 规划与 known-issues 欠账，是本方案一切"实时性"的前提：

- FileSystemWatcher（500ms 去抖）驱动变更页/状态栏自动刷新；
- 30s 焦点轮询兜底 + 后台 fetch（间隔可配，默认 5 分钟，仅当配置了 upstream）；
- **GitWorker 接线**：代码已有未接线（known-issues 2.3），所有新增后台任务统一入队，避免与前台操作争抢 libgit2 句柄。

### 7.2 内置 MCP Server

把 Gitter 的结构化 git 能力暴露给本机任意 agent（Claude Code / Cursor / 其他 MCP 客户端）：

- 传输：stdio + 本机命名管道（`gitter mcp serve` 子命令或设置页开关）；
- 工具集（只读优先）：`repo.status` / `repo.diff` / `repo.log` / `repo.branches` / `repo.worktrees` / `repo.stage` / `repo.commit` / `review.submit_feedback`（agent 主动请求人对某 hunk 的反馈，反哺 §3.4 闭环）；
- 价值双向：① agent 免去裸解析 git 文本输出，获得 Gitter 已整理好的结构化视图；② agent 经 Gitter 执行的写动作自带溯源标注，反哺 §3.2 provenance；
- Gitter 由此获得深层定位：**不写代码，但成为 agent 与人共享的 git 事务层。**

### 7.3 Agent 活动感知

- 终端输出模式识别（挂在 TerminalParser 输出流上，模式表可扩展为 `policy` 包的一部分）：识别常见 agent CLI（Claude Code / Codex 等）正在某 tab 运行；
- 联动表现：状态栏"agent 工作中"指示 + 任务卡活动徽标 + 变更页红点（watcher 事件驱动）；
- 审查提示：agent 输出出现"任务完成"类信号时，变更页横幅提示"agent 已完成，查看会话 diff"（点击直达 §3.1 视图）。

### 7.4 反向桥（升级为 Agent Harness 框架）

- 单向的反馈投递已升级为完整的双向 agent 接入框架，见 **§十二 Agent Harness 扩展框架**；
- "退回重做"（§3.4）的反馈直投由 harness 的 `FeedbackChannel` 能力承载；Gitter 核心仍不内置任何特定厂商。

---

## 八、横切：AI 接入架构

### 8.1 IAiGateway（GitUI.Core 定义接口）

```text
IAiGateway
├─ CompleteAsync(prompt, context, budget)   // 通用补全（message 生成、解释、批注）
├─ Provider                                 // OpenAI 兼容 / Anthropic / Ollama / CliBridge
└─ 事件：Progress / Failed（UI 非阻塞展示）
```

- 内置四类 provider；**命令行桥**（`CliBridge`）最关键：把 prompt 经 stdin 给用户自配的任意 CLI、读 stdout——零 SDK 依赖、天然复用用户已有订阅与配置；
- Gitter 不托管 key：密钥存系统凭据库（DPAPI），设置页只做端点/命令配置；
- 超时/预算：单次调用默认 60s，取消按钮贯穿所有 AI 交互。

### 8.2 隐私分级（设置页三档，发送前强制过筛）

| 档位 | 发送内容 |
|---|---|
| 关闭 | 不发送任何内容，AI 功能整体禁用 |
| 仅元数据 | 文件名 + 增删行数 + message 上下文（不含代码） |
| 完整 diff | staged/会话 diff 全文（发送前过 secrets 规则，命中即阻断并提示） |

- 本地端点（127.0.0.1 / Ollama）不受档位限制，仅提示"本地端点"徽标。

### 8.3 扩展包框架新 kind

复用 .gpk 全套机制（manifest 校验、按 kind 启停、Jint 沙箱、用户包目录）：

| kind | 内容 |
|---|---|
| `policy` | 安全网/风险信号规则（声明式 JSON + 可选 JS） |
| `ai` | provider 适配（走 CliBridge 语义）、prompt 模板、解释/批注风格 |
| `harness` | 编程 agent 运行时适配（DeepSeek harness、Claude Code、Codex 等），详见 §十二 |

`PackageRegistryState.DisabledKinds` 已按 kind 设计（"包id:种类"条目），天然兼容，设置页卡片无需改模型。

---

## 九、明确不做的事（边界）

| 不做 | 理由 |
|---|---|
| inline 代码补全 / 内嵌 chat 面板 | 那是 IDE 的职责；Gitter 定位代码管理，不越界（定位输入明确） |
| 内置模型、key 托管、Gitter 云服务 | 本地优先、无云（原则 1.2-1） |
| 无人确认的 git 写操作 | 人保留最终决定权（原则 1.2-2）；包括 MCP 工具集中 `repo.commit` 的默认确认开关 |
| PR 协作 / 远程 review | 维持 v1 边界（README 明确不做）；验收台能力未来可自然延伸，但不在本方案 |
| AI 生成的解释/批注写入仓库 | AI 输出只存在于会话内存与 trailer 署名，不污染 git 数据 |

---

## 十、落地路线（每阶段独立可发布，映射现有模块）

| 阶段 | 交付 | 触碰的现有模块 | 依赖 |
|---|---|---|---|
| **P0 实时基座** | FileSystemWatcher + 焦点轮询 + 后台 fetch + GitWorker 接线 | GitUI.Git（Worker/Service）、ViewModels、MainWindow 注入 | 无（同时偿还 known-issues 欠账） |
| **P1 提交事务** | 规则版安全网（secrets/大文件/调试残留）+ PrefixSuggestions 升级 + IAiGateway + message 生成 | GitUI.Core（接口/设置）、ChangesViewModel/ChangesPage | 不强依赖 P0 |
| **P2 验收台 v1** | 风险信号叠加 + AI 解释批注栏 + hunk 拒绝/退回重做（剪贴板形态） | DiffCanvas 覆盖层、DiffRenderModel、ChangesPage | P1 的 gateway 与规则库 |
| **P3 并行工作台** | worktree/fetch/cherry-pick/reset/tag/stash 能力补齐 + 任务卡页 + 多终端 tab | IRepositoryService、BranchesPage、TerminalPage、导航 | P0 |
| **P4 会话历史** | 会话卡聚合 + trailer 规范 + 过滤语法 + session squash | LogViewModel/LogFilterParser、LogPage、ChangesViewModel | P0 |
| **P5 Agent 桥** | MCP server + agent 活动感知 + 反馈闭环（review.submit_feedback） | GitUI.Shell（TerminalParser 钩子）、新宿主进程/管道层 | P2/P4 |

- **H 系列（Agent Harness，§十二）**：H0 接口冻结 + `cli-pty` 形态（随 P3 任务卡落地）→ H1 `cli-json` 事件流（随 P5）→ H2 `acp` 全双工（权限卡 + 反馈直投）→ H3 harness 包生态；
- 每阶段都有**非 AI 兜底形态**（P1 规则建议、P2 纯规则风险信号、P4 时间窗启发识别），AI 不可用不阻塞发布；
- 测试风格延续仓库现有守卫：规则引擎/会话识别纯函数化进 Core 测试（黄金用例 + 参数化拓扑），gateway mock，MCP 协议层单测，DiffCanvas 覆盖层走既有 headless 软件光栅化渲染测试。

---

## 十一、与现有框架的契合清单

| 现有框架 | 契合点 |
|---|---|
| .gpk 扩展框架 | 新增 `policy` / `ai` / `agent-bridge` 三种 kind；DisabledKinds 按 kind 启停已天然兼容；Jint 沙箱直接复用于规则与模板脚本 |
| 主题框架 | 新增语义令牌：批注色（AI 解释）、活动色（agent 工作中）、风险色（三级）；短期走 ActiveDiff/ActiveSyntax 旁路字典（与 Diff/Terminal 同形态），长期随 TokenKey 收编 |
| 命令面板 v2 | 新增 `@ai` 分类（生成提交信息 / 解释此 diff / 新建任务 / 打开 MCP 设置…），命令注册表直接扩展 |
| 高亮框架 | 风险规则按语言识别（调试输出模式）复用扩展名→highlighter 路由与语言元数据 |
| 终端 | 多实例已支持（纯 UI 编排）；活动识别挂 TerminalParser 输出流；MCP 反馈闭环的提示经终端 tab 徽标呈现 |
| 多窗口机制 | 任务卡双击开新窗口查看对应 worktree，机制现成 |
| .gpk（harness kind） | `harness` kind 复用扩展包校验/启停/用户包目录全套机制；manifest 新增 `harness` 段（传输形态/能力集/身份署名/权限边界），探测-启动-事件-停止生命周期见 §十二 |
| 危险操作确认 | worktree 清理/会话 squash 复用 `BranchDeleteImpact` 影响面 + "将丢弃 N 个提交"确认交互范式 |

---

## 十二、Agent Harness 扩展框架（编程 agent 的接入层）

### 12.1 概念与目标

**Harness = 编程 agent 的运行时封装**。Claude Code、Codex CLI、DeepSeek agent 这类编程 agent 各有各的 CLI 与协议，Gitter 不内置其中任何一家，而是定义统一的 harness 契约，让它们以 .gpk 扩展包形式接入任务工作台（§六）：

- **用户视角**："新建任务 → 选一个 agent → 派活 → 审查"，agent 品牌只是任务卡上的一个可插拔选项；
- **agent 视角**：获得 worktree 隔离、checkpoint 视觉化、审查反馈回注、权限请求 UI——Gitter 成为 agent 的宿主（harness 的本义）；
- **生态视角**：`com.deepseek.harness`、`com.anthropic.claude-code` 等包由厂商或社区发布，核心零绑定（延续 §九 边界：不内置特定厂商）。

### 12.2 四级传输形态（兼容性渐进）

| Transport | 形态 | Gitter 获得的信号 | 典型对象 |
|---|---|---|---|
| `cli-pty` | agent CLI 跑在 Gitter 内嵌终端（ConPTY，既有能力） | 终端回显 + 输出模式状态推断（§7.3） | 任意 CLI agent，零适配 |
| `cli-json` | 子进程管道驱动非交互/流式 JSON 输出（`-p --json` 类模式） | 真实事件流：阶段、checkpoint 提交、完成信号 | 支持流式 JSON 输出的 agent CLI |
| `acp` | Agent Client Protocol（stdio JSON-RPC 全双工，开放标准） | 全双工：权限回调、反馈直投、追加指令 | ACP 兼容 agent |
| `mcp` | 经 MCP 工具接口互操作 | 与 §7.2 互补：Gitter 既是 MCP server（暴露 git 能力），也可作 client 调用 agent 暴露的工具 | 暴露工具接口的 agent |

- 上级形态自动包含下级能力；manifest 按实际支持声明 `capabilities`，Gitter 按 capability **降级渲染 UI**（无 `structured-events` 就显示终端 + 推断状态徽标；无 `permission-prompts` 就引导用户看终端）；
- 终端永远是逃生舱：任何形态下任务卡都保留"打开原始终端"入口（cli-pty 形态下终端即本体）。

### 12.3 manifest 扩展（kind: harness）

```json
{
  "schemaVersion": 1,
  "id": "com.deepseek.harness",
  "name": "DeepSeek Agent Harness",
  "kinds": ["harness"],
  "engines": { "gitui": ">=1.0" },
  "harness": {
    "transport": "cli-json",
    "fallback": "cli-pty",
    "detect":   { "command": "deepseek-agent", "args": ["--version"], "versionPattern": "\\d+\\.\\d+" },
    "spawn":    { "command": "deepseek-agent", "args": ["--workdir", "{worktree}", "--prompt-stdin"],
                  "resumeArgs": ["--resume", "{sessionId}"] },
    "stop":     { "mode": "kill" },
    "capabilities": ["structured-events", "checkpoints", "session-diff", "feedback-channel", "permission-prompts", "file-watch"],
    "submissionMode": "next-turn",
    "hostServices": ["host-checkpoints"],
    "identity": { "assistedBy": "deepseek-agent", "authorEmailPattern": ".*@deepseek\\.harness$" },
    "permissions": { "gitWrite": ["stage", "commit"], "outsideWorktree": false, "network": "model-endpoint" },
    "promptTemplates": {
      "preamble": "你在 Gitter 管理的隔离任务 worktree（{worktree}）中工作……完成后输出总结。",
      "feedback": "以下是人工审查者的反馈，只处理这些条目：\n{feedback}"
    },
    "events": {
      "lineFormat": "jsonl",
      "externalId": "$.thread_id",
      "rules": [
        { "when": "$.type == 'turn.started'", "emit": { "kind": "status", "phase": "Thinking" } },
        { "when": "$.type == 'item.completed' && $.item.item_type == 'file_change'",
          "emit": { "kind": "fileChange", "from": "$.item.changes[*]" } },
        { "when": "$.type == 'turn.completed'", "emit": { "kind": "turnCompleted", "usage": "$.usage" } }
      ],
      "unmatched": "log"
    }
  }
}
```

- `detect`：安装时/启动时探测本机 CLI 是否可用（未探测到 → 任务卡选项置灰并提示安装方式）；
- `spawn`：`{worktree}` 由 Gitter 注入任务 worktree 路径，任务描述经 stdin 传入（避免命令行长度/转义问题）；
- `identity`：对接 §5.2 会话规范——harness 打的 checkpoint 提交自动携带 `Assisted-by:` 与 `Gitter-Session:` trailer，Log 会话卡识别获得最可信来源；
- `permissions`：声明式权限边界（见 §12.6），首次启用时向用户展示并确认；
- `fallback`（v1.2）：主形态启动失败时的降级形态（如 cli-json → cli-pty），UI 提示降级原因；
- `submissionMode`（v1.2）：指令追加语义——`none`（一次性运行）/ `next-turn`（轮次间追加，经 resume 起新轮，Codex exec 形态；FeedbackChannel 的实现载体）/ `streaming`（运行中即时注入，ACP 全双工）；
- `hostServices`（v1.2）：请求宿主提供的能力，首发 `host-checkpoints`（见 §12.9）；
- `stop`（v1.2）：停止策略 `kill` / `graceful-signal`；
- `promptTemplates`（v1.2）：preamble / feedback 等模板，`{worktree}`/`{taskId}`/`{feedback}` 占位符由宿主注入；
- `events`（v1.2）：**声明式事件映射**——协议帧 → `AgentSessionEvent` 的规则表。`when` 用极小 JSONPath 子集（属性路径 + `==` + `&&` + 字面量），纯函数求值器进 Core（黄金用例测试），**刻意不用 Jint**（规则是数据不是脚本，可审计、可快照测试）。未匹配帧按 `unmatched` 策略落 `AgentLogEvent`，永不丢弃——协议漂移由 harness 包升级映射表吸收，不动 Gitter 代码；`externalId` 声明外部会话号字段（resume 键，落 §12.9 账本）。

### 12.4 预留接口（v1.3 起权威落点 app/src/services/agents，TS/zod；本节形状栈无关，签名以实施为准）

```csharp
namespace GitUI.Core.Agents;

// —— 能力协商：UI 按位降级 ——
[Flags]
public enum HarnessCapability
{
    None = 0,
    StructuredEvents  = 1 << 0,   // 结构化事件流（cli-json 及以上）
    Checkpoints       = 1 << 1,   // agent 主动打 checkpoint 提交（事件反哺 §5 会话卡）
    SessionDiff       = 1 << 2,   // 提供会话级变更摘要（§3.1 会话基线数据源之一）
    FeedbackChannel   = 1 << 3,   // 可接收审查反馈（§3.4 退回重做直投）
    PermissionPrompts = 1 << 4,   // 权限请求回调（§12.6）
    Resume            = 1 << 5,   // 支持会话恢复（Gitter 重启后 reattach）
    PromptSubmission  = 1 << 6,   // 可向会话追加指令（语义按 SubmissionMode 分级，v1.2）
    FileWatch         = 1 << 7,   // v1.2：事件流含文件级变更（file-change 类，任务卡实时计数）
}

public enum HarnessTransport { CliPty, CliJson, Acp, Mcp }

// v1.2：指令追加语义分级（PromptSubmission 能力的落地形态）
public enum HarnessSubmissionMode
{
    None,        // 一次性运行，不可追加
    NextTurn,    // 轮次间追加：以 resume 新起一轮（如 Codex exec resume）——FeedbackChannel 的实现载体
    Streaming,   // 运行中即时注入（ACP 全双工，H2）
}

// —— 一个扩展包注册一个 IAgentHarness（类型级，无状态）——
public interface IAgentHarness
{
    HarnessDescriptor Descriptor { get; }
    IAsyncEnumerable<HarnessInstall> DetectAsync(CancellationToken ct);      // 探测本机可用性
    Task<IAgentSession> StartSessionAsync(AgentStartOptions options, CancellationToken ct);
}

// —— v1.2：启动选项（v1.1 被引用未定义，此处补全；签名以实施为准）——
public sealed record AgentStartOptions(
    string TaskId,                        // 关联任务卡与会话账本（IAgentTaskStore）
    string WorktreePath,                  // 强制：spawn cwd（permissions.outsideWorktree=false 时校验归属）
    string? Prompt,                       // 首轮任务描述，经 stdin（规避命令行长度/转义）
    string? ResumeSessionId,              // 非空 = 续跑外部会话（ExternalSessionId）
    string? Model,                        // harness 语义的模型/推理力度
    AgentSandboxPolicy Sandbox,           // 映射到各 harness 沙箱参数（如 codex --sandbox）
    IReadOnlyDictionary<string, string>? Environment,   // 附加环境变量（宿主白名单过滤后）
    string? Preamble);                    // 宿主注入的任务约定前置（模板见 manifest promptTemplates.preamble）

public enum AgentSandboxPolicy { ReadOnly, WorkspaceWrite, FullAccess }

public sealed record HarnessDescriptor(
    string Id, string DisplayName,
    HarnessTransport Transport,
    HarnessTransport? FallbackTransport,  // v1.2：降级形态（cli-json 失败 → cli-pty）
    IReadOnlySet<HarnessCapability> Capabilities,
    HarnessIdentity Identity,             // trailer 署名等（§5.2）
    HarnessSubmissionMode SubmissionMode = HarnessSubmissionMode.None,   // v1.2
    string? VersionPattern = null);       // v1.2：detect 探测到的版本须匹配，防协议漂移误配

// —— 一次运行的会话实例（绑定 worktree，有状态）——
public interface IAgentSession : IAsyncDisposable
{
    string SessionId { get; }
    HarnessDescriptor Harness { get; }
    string WorktreePath { get; }
    AgentSessionState State { get; }   // Starting/Working/AwaitingPermission/Idle/Completed/Failed/Stopped
    event EventHandler<AgentSessionEventArgs> Event;
    Task SubmitPromptAsync(string prompt, CancellationToken ct);             // 派任务 / 追加指令
    Task SubmitFeedbackAsync(IReadOnlyList<ReviewFeedback> feedback, CancellationToken ct);  // §3.4
    Task<AgentStopResult> StopAsync(bool kill, CancellationToken ct);        // kill=false 请求优雅收尾
}

// v1.2：事件信封（v1.1 被引用未定义）
public sealed record AgentSessionEventArgs(string SessionId, AgentSessionEvent Event, DateTimeOffset Timestamp);

public enum AgentPhase { Starting, Thinking, Editing, RunningCommand, RunningTests, AwaitingInput, Idle, Finished }
public enum AgentStreamKind { Terminal, Assistant, Tool }
public enum AgentOutcome { Completed, Failed, Cancelled }

// —— 事件模型（cli-pty 形态退化为输出推断事件；cli-json/acp 为真实事件）——
public abstract record AgentSessionEvent;
public record AgentStatusEvent(AgentPhase Phase, string? Summary) : AgentSessionEvent;      // 推理/改码/跑测试…
public record AgentOutputEvent(string Text, AgentStreamKind Kind) : AgentSessionEvent;      // 终端回显
public record AgentCheckpointEvent(string CommitSha, string Summary) : AgentSessionEvent;   // → §5 会话时间线
public record AgentPermissionEvent(PermissionRequest Request,
    TaskCompletionSource<PermissionDecision> Reply) : AgentSessionEvent;                    // → 任务卡内联授权卡
public record AgentQuestionEvent(string Question, IReadOnlyList<string> Options,
    TaskCompletionSource<int> Reply) : AgentSessionEvent;                                   // agent 选择题
public record AgentCompletedEvent(AgentOutcome Outcome, string? Summary) : AgentSessionEvent; // → §7.3 审查提示

// —— v1.2 新增事件：驱动任务卡时间线 / 宿主托管 checkpoint / 会话账本 ——
public record AgentSessionMetaEvent(string ExternalSessionId) : AgentSessionEvent;
//   外部会话号到达（如 Codex thread id）→ resume 键，落 §12.9 账本
public record AgentFileChangeEvent(string Path, FileChangeKind Kind, string? Summary) : AgentSessionEvent;
//   文件级变更 → 任务卡"改动中 N 文件"实时计数 + 时间线
public enum FileChangeKind { Added, Modified, Deleted, Renamed }
public record AgentTurnCompletedEvent(TurnUsage? Usage, string? LastMessage) : AgentSessionEvent;
//   轮次边界 → IHostCheckpointService 的触发点；LastMessage 供任务卡摘要与账本
public sealed record TurnUsage(int? InputTokens, int? OutputTokens, int? CachedTokens);
public record AgentLogEvent(AgentLogLevel Level, string Text) : AgentSessionEvent;
//   未匹配的协议帧 / 探测启动诊断 → 前向兼容的降级出口
public enum AgentLogLevel { Debug, Info, Warn, Error }

// —— 权限请求载荷（v1.1 被引用未定义，v1.2 补全）——
public sealed record PermissionRequest(
    PermissionKind Kind, string Title, string Detail,
    string? Command, IReadOnlyList<string> AffectedPaths);
public enum PermissionKind { Command, GitWrite, Network, OutsideWorktree, FileWrite }
public sealed record PermissionDecision(bool Allow, bool RememberForSession);

// —— 审查反馈载荷（§3.4 退回重做的直投载体，核心只定格式，投递由 harness 实现）——
public sealed record ReviewFeedback(
    string FilePath, int? OldStart, int? NewStart,
    string Issue, string Constraint);

// —— v1.2：传输适配器契约（内置四个：CliPty/CliJson/Acp/Mcp；落点 GitUI.Shell，纯 C# 无 UI 依赖）——
// harness 包是纯 JSON（无代码入口），协议细节由内置适配器消化、manifest 驱动
public interface IHarnessTransportAdapter
{
    HarnessTransport Transport { get; }
    bool CanLaunch(HarnessLaunchSpec spec);
    Task<IAgentSession> LaunchAsync(HarnessLaunchSpec spec, AgentStartOptions options, CancellationToken ct);
}
public sealed record HarnessLaunchSpec(
    string Command, IReadOnlyList<string> ArgTemplates, bool PromptStdin,
    IReadOnlyDictionary<string, string> Env,
    SpawnTemplate? Resume, StopPolicy Stop, HarnessEventMap Events);
public enum StopPolicy { Kill, GracefulSignal }
// HarnessLaunchSpec / HarnessEventMap = manifest harness 段的编译产物（Catalog 扫描时编译并校验）；
// HarnessEventMap 即 §12.3 events 段（声明式映射表）

// —— v1.2：宿主侧服务（Core 只定契约，实现落 App 层；延续分层守卫）——
public interface IAgentCatalog
{
    // 枚举已启用的 .gpk harness 包 → 编译 HarnessLaunchSpec；detect 探测 + VersionPattern 匹配
    Task<IReadOnlyList<HarnessDescriptor>> ListAsync(CancellationToken ct);
    Task<HarnessProbeResult> ProbeAsync(string harnessId, CancellationToken ct);
}

public interface IAgentSessionManager
{
    Task<IAgentSession> StartAsync(string harnessId, AgentStartOptions options, CancellationToken ct);
    IReadOnlyList<AgentTaskRecord> ActiveSessions { get; }
    event EventHandler<AgentSessionEventArgs> SessionEvent;   // 任务卡/状态栏/活动指示统一订阅点（UI 线程封送）
    Task StopAllAsync(bool kill, CancellationToken ct);       // Gitter 退出时按设置终止或保留
}

// 任务↔会话账本：.git/gitter/agent-tasks.json（仓库本地、不入版本控制、跟随克隆）
public interface IAgentTaskStore
{
    Task<IReadOnlyList<AgentTaskRecord>> LoadAsync(string repoWorkDir, CancellationToken ct);
    Task SaveAsync(string repoWorkDir, AgentTaskRecord record, CancellationToken ct);
}

public sealed record AgentTaskRecord(
    string TaskId, string Title, string HarnessId,
    string WorktreePath, string Branch,
    string? ExternalSessionId,      // resume 键（AgentSessionMetaEvent 写入）
    string? BaselineSha,            // 会话基线（§3.1 squash 视角 diff 的起点）
    AgentTaskState State, DateTimeOffset CreatedAt, DateTimeOffset? LastActiveAt,
    string? LastMessage);
public enum AgentTaskState { Starting, Working, AwaitingInput, AwaitingPermission, Completed, Failed, Interrupted, Stopped }

// v1.2：宿主托管 checkpoint（agent 默认不打提交时的兜底，动机与约束见 §12.9）
public interface IHostCheckpointService
{
    // 触发：AgentTurnCompletedEvent + FileSystemWatcher 静默确认（500ms）
    // 动作：仅在任务 worktree 内 git add -A && git commit，
    //       trailer Assisted-by / Gitter-Session 由 Gitter 代打；经 GitWorker 入队
    Task<string?> CommitCheckpointAsync(AgentTaskRecord task, string summary, CancellationToken ct);
}
```

- **Gitter 核心只依赖上述接口与事件**；`cli-json`/`acp`/`mcp` 的协议细节在内置 transport 适配器（`IHarnessTransportAdapter`，落点 GitUI.Shell）内消化，帧 → 事件的翻译由 manifest `events` 声明式映射驱动（求值器纯函数进 Core，无脚本宿主）；
- 宿主侧服务（`IAgentCatalog` / `IAgentSessionManager` / `IAgentTaskStore` / `IHostCheckpointService`）Core 只定契约，实现在 App 层；
- 接口落点 GitUI.Core（纯模型，无 UI 依赖），编排宿主见 §12.6——延续仓库分层守卫（DependencyCheckTests）风格；
- **v1.2 变更摘要**（详析见 docs/agent-harness-codex.md §四）：补全 `AgentStartOptions` / `PermissionRequest` / `PermissionDecision` / `AgentSessionEventArgs` / `AgentPhase` 等被引用未定义的记录；新增 `AgentSessionMetaEvent` / `AgentFileChangeEvent` / `AgentTurnCompletedEvent` / `AgentLogEvent` 四类事件；`HarnessCapability` 增 `FileWatch`；`HarnessDescriptor` 增 `FallbackTransport` / `SubmissionMode` / `VersionPattern`；新增传输适配器契约与宿主侧服务接口。原七位能力位与事件骨架不变。
- **v1.3 重排（2026-10-05，随插件系统 v2 与 Web 栈）**：本节 C# 形状按「record→interface、Flags 枚举→字符串字面量联合（与 manifest 直转）、TaskCompletionSource→宿主侧 deferred」平移为 TS 判别联合（已冻结的 AgentHarness.cs 为对应实现）；harness 包从自定义 kind 改为 `contributes.harnesses`（信任级 L1 声明式，PackageStore `packages[id].kinds` 账本启停）；"统一确认队列"并入 safety.ts 人审门（操作目录确认策略为其策略输入）；MCP 双向统一 @modelcontextprotocol/sdk；agent-host 子进程化取消（Electron 主进程 + Job Object 即隔离边界）；与 agentLoop（extension-system-v2 §十五）的关系界定及"内置循环包装为 harness"决策门见 agent-harness-codex.md v2.0 §五。

### 12.5 会话 ↔ 任务卡 ↔ worktree 三元组

- **一个任务卡 = 一个 worktree + 一个 harness 会话 + 一个会话基线**（§3.1）：新建任务流程变为"选 harness（列出探测到的可用项）→ 自动建 worktree → spawn → 输入任务描述"；
- `AgentCheckpointEvent` 实时推进会话时间线（§5.1 会话卡数据源）；`AgentCompletedEvent` 触发"agent 已完成，查看会话 diff"审查提示（§7.3）；
- harness 不在场时任务卡照常工作（手动开终端派活），harness 是增强而非前置依赖。

### 12.6 安全模型

| 层 | 机制 |
|---|---|
| 进程边界 | harness 进程由独立 **agent-host 子进程**编排（崩溃隔离、孤儿回收；Gitter 退出时可配置终止或保留 agent 会话）；子进程化（H3）前以 **Windows Job Object（KILL_ON_JOB_CLOSE）**收编 agent 进程树防孤儿 |
| 环境变量 | spawn env = 父进程 env − `EnvDenylist`（默认剔除 `GH_TOKEN` 等凭据类）+ manifest `env` 注入（`GITUI_*` 标记便于溯源）；agent 认证走其自有配置（如 `~/.codex`），Gitter 不经手 |
| worktree 隔离 | `outsideWorktree: false` 时 spawn cwd 强制定位任务 worktree；Gitter 侧 git 操作校验路径归属 |
| git 写白名单 | manifest 声明 + 用户确认；默认仅 `stage`/`commit`（checkpoint 语义）；branch/merge/push 等在任务卡上逐次显式授权 |
| 经 Gitter MCP 的写操作 | 与 §7.2 共用同一确认通道（原则 1.2-2：无人工确认不落盘） |
| 权限请求 UI | `AgentPermissionEvent` → 任务卡内联授权卡（不抢焦点弹窗），会话进入 `AwaitingPermission` 徽标态 |
| 启停粒度 | 复用 DisabledKinds 按 kind 启停：停用 harness 包即从任务卡选项移除，运行中会话提示收尾 |

### 12.7 与既有章节的衔接

- **吸收 §7.4 反向桥**：`ReviewFeedback` + `FeedbackChannel` 能力即原"反馈直投"；`agent-bridge` kind 不再单设；
- **§3.4 退回重做**：v1 剪贴板 → **H1 起**经 `SubmitFeedbackAsync` 直投（`SubmissionMode=NextTurn`：以 resume 投递反馈轮，cli-json 形态即可为真）→ H2 Streaming 即时注入；
- **§5.2 会话识别**：harness 在场时 `AgentCheckpointEvent` + trailer 为最可信来源——agent 不打提交时由宿主托管 checkpoint 代打 trailer（§12.9），归组键不依赖 agent 自觉；不在场时退化为 trailer/时间窗启发；
- **§7.3 活动感知**：`cli-pty` 形态即其现状；高级形态下活动徽标直接来自 `AgentStatusEvent`，模式识别退居兜底；
- **§7.2 MCP**：方向互补——MCP server 面向"agent 用 Gitter 的 git 能力"，harness 面向"Gitter 宿主 agent 的运行"；`mcp` transport 复用同一管道层。

### 12.8 H 系列落地阶段（并入 §十 路线）

| 阶段 | 交付 | 依赖 |
|---|---|---|
| **H0**（随 P3） | 接口冻结（GitUI.Core/Agents）+ `cli-pty`：任务卡拉起任意 CLI agent 于 worktree 终端，状态靠 §7.3 推断 | P3 任务卡 + 多终端 tab |
| **H1**（随 P5） | `cli-json` 事件流解析（声明式映射）：checkpoint/轮次事件驱动会话卡、完成信号触发审查提示、宿主托管 checkpoint、会话账本与 resume、反馈直投（NextTurn，§3.4 v2） | P4 会话历史 |
| **H2** | `acp` 全双工：权限请求内联卡、prompt/反馈 Streaming 即时注入（§3.4 直投已于 H1 以 NextTurn 落地） | H1 |
| **H3** | harness 包生态：.gpk 分发与检测向导、per-project 默认 harness、agent-host 加固、多 harness 并存管理 | H2 |

- 首个 harness 包（`com.openai.codex`）的完整适配设计、代码现状核对与 C0–C3 实施切片见 **docs/agent-harness-codex.md**（与本表 P/H 阶段对齐）。

### 12.9 宿主托管 checkpoint 与会话账本（v1.2 新增）

- **动机**：并非所有 agent 都主动打 checkpoint 提交（如 Codex 默认直接改文件）。若宿主不介入，§5 会话时间线、§3.1 会话基线推进与 §4.3 会话整理对这类 agent 整条断链；
- **机制**：manifest `hostServices: ["host-checkpoints"]` 声明请求 + 任务卡开关。`AgentTurnCompletedEvent`（+ FileSystemWatcher 500ms 静默确认）后，由 `IHostCheckpointService` **仅在任务 worktree** 执行 `git add -A && git commit`：message 取轮次摘要，trailer `Assisted-by:` / `Gitter-Session:` 由 Gitter 代打——§5.2 会话归组因此不依赖 agent 自觉遵守约定；主 worktree 永不自动提交；agent 被用户显式允许自行提交（`permissions.gitWrite` 非空）时自动让位，避免双重 checkpoint；经 GitWorker 入队，不与前台争抢；
- **会话账本**：任务↔会话映射持久化于 `.git/gitter/agent-tasks.json`（仓库本地、不入版本控制）。`ExternalSessionId` 为 resume 键；Gitter 重启后未完成会话标 `Interrupted`，任务卡"续跑"（resume）/ "放弃"两键，agent 侧会话文件（如 `~/.codex/sessions`）存续故续跑无损；
- **worktree 最小集先行**：harness 依赖 `IRepositoryService` 先补 `GetWorktrees` / `CreateWorktree` / `RemoveWorktree` / `PruneWorktrees`（§6.1 欠账的切片，git CLI 实现）。

---

## 十三、实施记录（2026-10-05，P0 + P1）

### 13.1 P0 实时基座（§7.1）✅

| 交付 | 落点 |
|---|---|
| GitWorker 接线 | `RepoMonitor` 的全部后台 git 调用（探测/fetch）统一经 `GitWorker` 单队列串行（known-issues 2.3 偿还）；前台路径维持"每请求独立句柄 + VM 信号量"不变 |
| FileSystemWatcher + 去抖 | `src/GitUI.Git/RepoMonitor.cs`：FSW（64KB 缓冲、500ms 固定 due-time 去抖、事件按 `.git/index`→Index、其余 `.git`→Head、工作区→Worktree 分类合并）；FSW 起不来（网络盘/权限）静默降级为轮询 |
| 焦点轮询兜底 | 30s 周期：HEAD SHA + `.git/index`/`.git/HEAD` mtime 探测比对，首个探测建基线不发事件 |
| 后台 fetch | `IRepositoryService.GetRemotes/Fetch`（CLI 实现；无远程静默跳过，默认 origin，120s 超时）；间隔可配（1–120 分钟，默认 5），完成后静默刷新当前页 |
| MainWindow 接线 | 仓库打开/关闭 ↔ 监视启停；监视/fetch 设置变更重建监视器；事件回投 UI 线程 → 刷新当前页 + 变更页；窗口关闭释放监视器与 worker |
| 设置 UI | 设置页新增"实时监视与后台拉取"卡（监视开关 / fetch 开关 / 间隔） |

### 13.2 P1 提交事务（§四）✅

| 交付 | 落点 |
|---|---|
| 规则引擎（纯函数、零 AI 依赖） | `src/GitUI.Core/Rules/CommitSafety.cs`：`secret.leak`（AWS/GitHub/Slack/Anthropic-OpenAI key/JWT/私钥头/键值赋值，env-读取与占位符不误报）、`debug.residue`（js/ts `console.log|debug`/`debugger`、cs `Debug.WriteLine`、py `breakpoint()`、rs `dbg!`）、`large.file`（新文件 ≥2000 行）、`binary.incoming`；只扫 patch 新增行，注释行豁免；豁免路径支持精确/目录前缀/跨段通配 |
| 提交前安全网 | `ChangesViewModel.CommitAsync`：stage 之后 commit 之前扫描 staged patch（Off/Warn/Block 三档，设置页可切）；Block 命中即拒提（index 保持已暂存），摘要进错误横幅、全量发现走"复制错误详情"；Warn 模式提交继续并在 transient 带警告计数 |
| IAiGateway | `src/GitUI.Core/Ai/`：OpenAI 兼容（含 Ollama 预设）/ Anthropic / 命令行桥（stdin 传 prompt、引号感知命令解析、超时杀进程）三传输；失败统一 `AiGatewayException`；Gitter 不托管 key（DPAPI CurrentUser 加密存设置，`Platform/SecretProtector`） |
| AI 提交信息生成 | `CommitMessagePromptBuilder`：最近 20 条人写 message 做 few-shot 风格学习；隐私分级（MetadataOnly 只发路径+行数 / FullDiff 发 diff 截断 12k 字符且发送前过 secrets 规则命中即阻断）；草稿清理（围栏/引号/空行）；变更页 assistRow 新增"AI 生成"按钮，网关未配置置灰，结果填入输入框**必经人工确认**（原则 1.2-2） |
| Assisted-by trailer | 生成成功 → 该次提交自动追加 `Assisted-by: <model|provider>`（设置可关），消费一次不复读；对接 §5.2 会话规范 |
| 设置 UI | 设置页新增"AI 助手"卡：provider（关闭/Ollama/OpenAI 兼容/Anthropic/命令行桥）、端点、模型、API key（密码框）、CLI 命令、隐私级别、trailer 开关、安全网档位；全部热生效（`ChangesViewModel.UpdateAi`） |

### 13.3 测试与守卫

- 新增 66 个用例：`CommitSafetyScannerTests`（23：模式命中/误报豁免/只看新增行/注释豁免/大文件/二进制/豁免路径/排序）、`AiGatewayTests`（12：OpenAI 兼容请求形状与解析/错误码/坏响应、Anthropic 请求形状、命令行桥回显与非零退出、命令解析引号感知、工厂降级）、`CommitMessagePromptBuilderTests`（7：隐私分级/截断/few-shot 上限/草稿清理）、`RemoteFetchTests`（5：空远程/列表/无远程静默/本地 bare fetch/不可达抛错）、`RepoMonitorTests`（8：FSW 工作区与 HEAD 事件/纯轮询探测/自动 fetch 事件/路径分类/停止/切换目标）、`AiSafetyNetTests`（11：三档行为/index 保持/豁免/few-shot/trailer 开关与一次性/secrets 出网阻断/可用性切换）。
- 全量 `dotnet build` 零警告零错误；全解决方案测试绿（Core 129 / Git 138 / ViewModels 123 / Diff 96 / Shell 166 / Render 76）；`check-uia-conventions.ps1` 通过。
- 已知简化（记录为后续项）：轮询未做"仅窗口聚焦"门控（间隔与设计一致）；安全网逐项豁免 UI 未做（引擎已支持 ExemptPaths，设置层透出顺延）；P2 验收台、P3-P5、H 系列 harness 按路线推进。

---

## 十四、实施记录（2026-10-05，P2–P5）

### 14.1 P2 验收台 v1（§三）✅

| 交付 | 落点 |
|---|---|
| hunk 拒绝（审查三态之"拒绝"） | `IRepositoryService.ApplyWorktreePatch`（`git apply -R` 到工作区）+ `ChangesViewModel.RejectHunksAsync`；仅工作区视图可用（Staged 视图对应动作是撤销暂存） |
| 退回重做（v1 剪贴板形态） | `ReviewFeedbackBuilder`（Core 纯函数：选中 hunk patch + 批注 → 结构化修改指令）+ `BuildRetakeFeedback` + 变更页 ContentDialog（批注输入）→ 复制到剪贴板；H2 起可经 harness 直投 |
| 风险信号叠加 | `ScanRisksAsync`（复用 §4.2 同一规则库扫 staged/worktree patch，300 文件上限、单文件失败跳过、LoadCore 后自动触发）+ 文件行红/琥珀风险点（tooltip 带计数）；画布内 hunk 级标记顺延 |
| AI 解释批注栏 | `ExplainPromptBuilder`（解释/审查两种意图）+ `ExplainAsync`（非阻塞、可取消，隐私分级与 secrets 出网阻断同生成策略）+ 变更页 AI 批注面板（可选中文本、随语言热切换） |

### 14.2 P3 并行工作台（§六）✅

| 交付 | 落点 |
|---|---|
| git 能力补齐 | `IRepositoryService` 新增 `GetWorktrees`（porcelain 解析）/`CreateWorktree`（-b 新分支，起点=默认分支 origin/HEAD→main→master→HEAD）/`RemoveWorktree`（脏区拒绝+prune 兜底）/`PruneWorktrees`/`CherryPick`/`ResetTo`（Soft/Mixed/Hard，无 `--`）/`CreateTag`/`Stash`（含未跟踪，空树返回 false）/`StashPop`/`DefaultBranchName` |
| 任务页 | 新导航页签"任务"（Ctrl+5，顺延终端/设置快捷键）：worktree 任务卡（分支、路径、脏文件数、短 SHA、主 worktree 徽标）+ 快速动作：打开（当前窗口切到该 worktree）/ 新窗口（`App.OpenNewWindow(workDir)` 新增重载）/ 合并回主分支（确认 + ff-merge 到主 worktree 当前分支）/ 移除（确认）；新建任务（slug 规范化 `task/<name>`，落盘 `%LOCALAPPDATA%\GitUI	asks\<仓库-hash>\`，避免污染仓库 status）+ 清理失效 |
| 多终端 tab | 顺延（单终端 + 任务卡"打开"经 RepositoryContext 跟随切 cwd，TerminalFollowRepo 现有机制） |

### 14.3 P4 会话历史（§五）✅

| 交付 | 落点 |
|---|---|
| trailer 解析 | `CommitTrailers.Read`（Core 纯函数：message 末段解析 `Assisted-by:`/`Gitter-Session:`，正文中的冒牌 trailer 不误报） |
| 会话聚合 | `LogSessionGrouping.Group`（连续同 agent + session trailer 归组优先；无 trailer 按时间窗 ≤30 分钟；人写提交打断连续性；孤立 AI 提交不成组只打徽标） |
| Log 页会话卡 | `LogSessionRow`（紫 chip + agent 名 + 提交数 + 相对时间，点击展开/折叠成员提交，跨天会话折叠吞全组）；孤立 AI 提交打紫色 AI 徽标 |
| session squash | `LogViewModel.SquashSessionAsync`（守卫：会话 tip 必须是 HEAD、最老提交非根；`ResetTo Soft` + 聚合 message 重新提交；reflog 可回退）+ 会话卡"整理为一次提交"（确认框） |
| 过滤语法 | `is:ai` / `agent:<id>` → `LogFilter.Agent`（"*"=任意 AI 署名；其他=Assisted-by 子串）；服务端 `MatchesAgent` 走 trailer 解析；Agent 过滤跳过 rev-list 快路径（正确性优先） |

### 14.4 P5 Agent 桥与实时感知（§七）✅

| 交付 | 落点 |
|---|---|
| MCP 协议层 | `GitUI.Core/Mcp/JsonRpc.cs`（按行 JSON-RPC 2.0 解析 + 响应构造，MCP stdio 规范） |
| MCP 工具层 | `GitUI.Git/Mcp/GitterMcpServer.cs`：`initialize`/`tools/list`/`tools/call`/`ping`；工具 `repo.status`/`repo.log`（AI 署名标注）/`repo.diff`/`repo.branches`/`repo.worktrees` + 写工具 `repo.stage`/`repo.commit`（**默认禁用**，`AllowWrites` 门控——原则 1.2-2）+ `review.submit_feedback`；工具执行异常按 MCP `isError` 内容返回 |
| 无头入口 | `GitUI.App.exe --mcp <repoPath>`：跳过窗口创建，stdio 读一行处理一行，EOF 退出 |
| 反馈闭环 | `AgentFeedbackStore`（`.git/gitter/feedback.json`，损坏容错）；`review.submit_feedback` 落盘 → 变更页扫描时读出 → AI 批注栏顶部"agent 反馈"段展示（可清除） |
| agent 活动感知 | `AgentActivityMatcher`（Core 纯状态机：PTY 原始字节最小 VT 剥离 + 跨块 UTF-8 残尾处理 + 已知 CLI 签名表，上升沿报告）+ 终端页接线（状态条 "agent 运行中：xxx"）；签名表后续可扩为 policy 包 |

### 14.5 测试

新增 71 个用例：验收台（Core 6 + VM 12）、P3 服务能力（Git 10）、会话聚合与 trailer（Core 4 + VM 8）、agent 过滤与 squash（VM 6）、MCP server（Git 13）、活动识别（Core 8）、反馈存取（含于 MCP 测试）。

- 全解决方案 **797 用例绿**（Core 147 / Git 163 / ViewModels 149 / Diff 96 / Shell 166 / Render 76）、构建零警告零错误、`check-uia-conventions.ps1` 通过；全量并行跑时 Render/Shell 各有 1 例已知抖动（known-issues §四），单跑即绿。
- ~~已记录的顺延项~~：已全部实施，见 §十五（画布风险标记 / 多终端 tab / MCP 写确认 / harness 接口冻结与直投）。

---

## 十五、实施记录（2026-10-05，顺延项清偿）

### 15.1 DiffCanvas hunk 级风险标记（§3.3 画布层）✅

- `RiskHunkMapper.Map`（Core 纯函数）：finding 行号（新侧 1 基）→ hunk 序号，纯删除 hunk（NewCount=0）不可命中；
- `DiffCanvas.SetRiskHunks(blocked, warning)`：hunk 左缘 3px 色条（红 = 阻止级 / 琥珀 = 警告），与滚动同步、选中态不叠色，Load/Clear 自动清除；
- 变更页 `UpdateRiskMarks` 按当前文件发现实时映射；5 个映射测试。

### 15.2 多终端 tab（§6.3）✅

- TerminalPage 整页改造为 tab 容器：`TerminalTab`（独立 buffer/parser/canvas/session/活动识别/状态机），tab 条（"+" 新建、✕/右键关闭、当前高亮），每个 tab 独立 ConPTY 探测与双后端降级；
- 任务卡新增"终端"入口：`OpenWorktreeSession(title, cwd)` 开 **cwd 固定**的专用终端（不跟随仓库切换，同 worktree 复用）；跟随仓库仅作用于非固定 tab；
- shell 切换/重启/清屏/复制作用于当前 tab；语言热切换重建 tab 条；既有行为（键入暂存回放、空态、诊断钩子）逐 tab 保留。

### 15.3 MCP 写工具人审确认（§7.2，原则 1.2-2）✅

- `McpServerOptions.WriteApproval` 回调门：`AllowWrites=false` 且回调非空时，`repo.stage`/`repo.commit` 逐次请求人工批准（描述含操作细节，commit 展示首行）；回调异常按拒绝；3 个门控测试（批准/拒绝/回调抛异常）；
- `McpPipeHost`（GUI 内置命名管道宿主 `\.\pipe\gitui-mcp`）：随仓库/设置启停、仓库切换重建，每个连接独立 server 实例；
- 确认卡：MainWindow `ApproveAgentWriteAsync`（UI 线程 ContentDialog，**30 秒无响应自动拒绝**）；设置页"实时监视"卡新增 MCP 服务开关（默认开，写操作仍需逐次确认）；
- `--mcp` 无头模式（stdio）不受影响：无 UI 时回调为空 → 写工具按原样拒绝。

### 15.4 Harness H 系列切片（§十二）✅（接口冻结 + 直投 v2）

- **H0 接口冻结**：`GitUI.Core/Agents/AgentHarness.cs`——`HarnessCapability`（7 能力位）/`HarnessTransport`（四级）/`HarnessDescriptor`/`HarnessIdentity`/`IAgentHarness`/`IAgentSession`/`AgentSessionState`/六类事件（Status/Output/Checkpoint/Permission/Question/Completed）/`PermissionRequest`·`Decision`/`ReviewFeedback`（hunk 定位 + 问题 + 约束）。Gitter 核心后续只依赖此契约；权限卡等 UI 待真实 harness 会话存在后接入（契约已预留 `AgentPermissionEvent`）；
- **反馈直投 v2（cli-pty 形态的 §3.4 闭环）**：终端页 `CanReceiveFeedback`（会话存活 + agent CLI 已识别）+ `SendText`（prompt 写入 PTY 回车提交）；退回重做对话框出现第二动作"发送到终端"（MainWindow 路由：切终端页 → 写入当前 tab），剪贴板形态保留为默认。

### 15.5 验证

- 新增测试：RiskHunkMapper 5 + MCP 审批门 3（MCP 合计 16）；
- 全解决方案 **806 用例绿**（Core 152 / Git 166 / ViewModels 149 / Diff 96 / Shell 166 / Render 76），构建零警告零错误；Shell 的已知并行抖动（known-issues §四）单跑即绿。
- 剩余待办（明确不在本轮）：H1–H3（cli-json/acp 事件流、权限卡 UI、harness 包生态）——等待真实 harness 包接入后按契约实施。

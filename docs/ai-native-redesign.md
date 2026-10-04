# Gitter 核心功能重设计：AI 编程时代的 Git 验收台

> 状态：设计提案 v1（2026-10-04），**仅设计方案，未动任何代码**
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

### 7.4 反向桥（v2，扩展形态）

- .gpk 新 kind `agent-bridge`：把"退回重做"的反馈 prompt 直投给指定 agent 的外部接口；
- Gitter 核心只定义反馈消息格式（hunk 定位 + 问题 + 约束），各 agent 的对接由扩展包实现——核心不内置任何特定厂商。

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
| `agent-bridge` | 反馈直投各 agent 的适配器 |

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
| 危险操作确认 | worktree 清理/会话 squash 复用 `BranchDeleteImpact` 影响面 + "将丢弃 N 个提交"确认交互范式 |

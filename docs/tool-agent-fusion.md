# Gitter 工具属性 × Agent 融合设计（工具面统一稿）

> 状态：设计提案 v1.0（2026-10-05），**仅设计稿，未动任何代码**
> 上位文档：docs/ai-native-redesign.md v1.2（功能域 + harness 接口）、docs/agent-harness-codex.md（宿主实例化）
> 本稿定位：**不新增功能域**，而是回答"Gitter 的工具属性怎么和 agent 融合"——给出一个统一的融合模型（工具面 / Operation Catalog），把此前分散在 §7.2（MCP 工具集）、§12.3（harness 权限白名单）、§4.2（提交安全网）、§3.4（hunk 三态）的机制收敛到一处，并补上融合中缺的一块拼图：**验收状态的人机双向共享**。

---

## 一、"融合"的定义与反融合边界

### 1.1 融合三命题

Gitter 的工具属性 = git 事务面的结构化能力（读：status/diff/log/影响面；写：stage/patch/commit/分支/历史）+ 验收台 + 会话历史 + 任务编排。与 agent 融合，指三件事：

| # | 命题 | 一句话 |
|---|---|---|
| 1 | **工具出口 agent 化** | Gitter 的工具能力成为 agent 可寻址、可组合、可控的调用面——agent 不必裸解析 git 文本 |
| 2 | **agent 输入数据化** | agent 的动作与会话成为 Gitter 工具视图的一等数据（会话卡、溯源徽标、活动指示）——agent 只是一个新的"变更来源" |
| 3 | **人的裁决共享化** | 验收三态（接受/拒绝/待审）成为人机共享状态，反向成为 agent 的输入——agent 知道人对上一轮的裁决 |

命题 1、2 在既有文档中已有落点（MCP server、harness、provenance）；**命题 3 是缺的拼图**，本稿补齐（§五）。

### 1.2 反融合边界（定位护栏，先于一切设计）

- Gitter 不做 agent 编排、工作流、多 agent 调度——agent 的智能归 agent，Gitter 只提供工作台与事务面；
- 不做 inline 补全 / 内嵌 chat（§九不变）；工具面的"对话感"止步于结构化调用与结构化反馈；
- 工具面是**薄层**：只做能力封装与策略执行（确认/溯源/审计），不含任何 agent 逻辑；
- 降级不变：拔掉所有 agent 与 MCP，Gitter 仍是完整 git 客户端——工具面对 UI 出口零行为改变（有守卫测试，§十）。

---

## 二、融合总纲：一套工具、三类客户端、一条闭环

```
                    ┌─────────────────────────────────────────┐
                    │   工具面 Tool Surface（本稿核心新增）      │
                    │   统一操作目录 Operation Catalog          │
                    │   id · 类别 · 确认策略 · 溯源 · 可见性     │
                    └───────┬──────────┬──────────┬───────────┘
        执行管线（同一套）：  │ 可见性检查 │ 确认策略  │ 安全网(写) │
                    ┌───────▼──┐  ┌────▼─────┐  ┌─▼──────────┐
                    │ GitWorker │  │ 溯源戳+审计│  │ IRepository │
                    └──────────┘  └──────────┘  └────────────┘
   ▲                    ▲三出口（同一 Operation 的三个投影）
   │
┌──┴─────────┐   ┌──────────┴───────┐   ┌────────────────┴───┐
│ 人（UI）    │   │ agent（MCP/CLI）  │   │ harness 宿主（内部） │
│ 按钮/命令面板│   │ 结构化工具调用     │   │ checkpoint/反馈直投  │
└────────────┘   └──────────────────┘   └────────────────────┘
```

**同源同构原则**（融合的正确性来源）：人点的按钮、agent 调的 MCP 工具、harness 宿主代打的 checkpoint，是**同一个 Operation 的三个投影**——走同一条执行管线、同一套确认策略、同一种溯源标注、同一份测试。由此推出四个一致性保证：

1. agent 经 Gitter 提交，与人手点提交过**同一道安全网**（§4.2 规则不因调用方而豁免）；
2. harness 权限白名单与 MCP 工具集**不会各自漂移**（都引用目录，一处定义两处消费）；
3. 确认交互**只有一种范式**（复用现有危险操作确认 + 任务卡内联卡，不因 agent 出现新交互物种）;
4. 溯源**只看目录不看调用方**——经 Gitter 通道的写统一打戳，验收台标注逻辑不变。

---

## 三、工具面：统一操作目录（核心新增）

### 3.1 Operation 记录模型

```csharp
namespace GitUI.Core.Tools;   // 纯模型，无 UI 依赖

public sealed record ToolOperation(
    string Id,                          // "repo.commit" / "review.state.read" …
    ToolCategory Category,              // Repo / Review / Task
    ToolAccess Access,                  // Read / Write
    ToolRisk Risk,                      // Low / Medium / High
    ConfirmPolicy Confirm,              // Auto / Session / EachTime / Hidden
    ProvenanceMode Provenance,          // None / Trailer / AuditOnly
    AgentVisibility Visibility);        // ReadWrite / ReadOnly / Hidden

public enum ConfirmPolicy
{
    Auto,      // 读操作与幂等安全操作，免确认
    Session,   // 会话内一次确认后记忆（范围 = agent 身份 × 操作 × 任务卡）
    EachTime,  // 每次确认，永不记忆（历史改写/分支删除/远端推送）
    Hidden,    // 不对 agent 开放（人专属写操作）
}

public enum AgentVisibility { ReadWrite, ReadOnly, Hidden }
```

### 3.2 首批目录（映射 `IRepositoryService` 真实方法）

| 操作 id | 现有实现（IRepositoryService.cs） | 类别 | 确认 | agent 可见性 |
|---|---|---|---|---|
| `repo.status` / `repo.log` / `repo.branches` | GetStatus / GetLog / GetBranches | 读 | Auto | RW |
| `repo.diff` | GetWorktreePatch / GetCommitDiff / GetTreeDiff / GetFileDiff / GetNumStat | 读 | Auto | RW |
| `repo.impact` | BranchDeleteImpact / UniqueCommits / MergeBase | 读 | Auto | RW |
| `repo.worktrees` | GetWorktrees / DefaultBranchName | 读 | Auto | RW |
| `repo.stage` / `repo.unstage` | Stage / Unstage | 写 | Session | RW |
| `repo.apply_patch` | ApplyIndexPatch / ApplyWorktreePatch（含 reverse = hunk 接受/拒绝） | 写 | Session | RW |
| `repo.commit` | Commit | 写 | Session（白名单默认）/ EachTime（可配严） | RW |
| `repo.branch.write` | CreateBranch / RenameBranch / DeleteBranch / Checkout | 写 | EachTime | RW |
| `repo.history.write` | Rebase / MergeBranch / ResetTo / CherryPick / Stash / StashPop | 写 | EachTime | RW |
| `repo.remote.write` | Push / Fetch | 写 | EachTime | RW |
| `repo.worktree.write` | CreateWorktree / RemoveWorktree / PruneWorktrees | 写 | Session（任务自建）/ EachTime（删他卡） | RW |
| `review.session_diff` | 规划（§3.1 会话基线） | 读 | Auto | RW |
| `review.risk_signals` | 规划（§3.3 规则引擎） | 读 | Auto | RW |
| `review.state.read` | **本稿新增**（§五） | 读 | Auto | **RO** |
| `review.state.write` | **本稿新增**（§五） | 写 | — | **Hidden**（人专属） |
| `review.submit_feedback` | 规划（§7.2 反向通道） | 写 | Session | RW |
| `task.checkpoint` | `IHostCheckpointService`（§12.9） | 写 | Auto（任务卡开关） | Hidden（harness 内部出口） |

目录即守卫测试的输入：`Hidden` 操作被 agent 通道调用必须拒绝；`EachTime` 永不出现"记忆"路径；纯读操作永远不触发确认。

### 3.3 执行管线（所有出口共用）

```
请求(来源: ui | mcp | harness, 携带 agent 身份)
  → 1 可见性检查（Hidden + 非人来源 → 拒绝，审计记录）
  → 2 确认策略（Session 未记忆/EachTime → 确认队列，§四；UI 来源走既有交互）
  → 3 [写] 安全网拦截（§4.2 规则库同源；命中按 阻止/警告 分档）
  → 4 执行（统一 GitWorker 入队，不与前台争抢句柄）
  → 5 溯源+审计（trailer 打戳 / audit.jsonl 追加）
  → 结果（结构化返回，错误分类与 UI 一致）
```

### 3.4 三处收敛（本稿对既有文档的修订指向）

| 既有机制 | 收敛后 |
|---|---|
| §7.2 MCP 工具集（手写清单） | 由目录**生成**——加一个 MCP tool = 目录加一行，不再单独维护 |
| §12.3 `permissions.gitWrite: ["stage","commit"]` | 后续收敛为**操作 id 引用**（`gitWrite: ["repo.stage","repo.commit"]`），manifest 校验直接对目录 |
| §4.2 安全网（提交时机扫描） | 变为写管线**拦截器**——任何出口的 `repo.commit` 都过，人写也不豁免（同源同构的直接收益） |

---

## 四、写路径融合：确认通道 + 溯源 + 审计

### 4.1 统一确认队列（人机同权，人批生效）

- agent 的写请求进入**确认队列**：有任务卡的进任务卡内联授权卡（§12.6 范式，不抢焦点），无任务卡的降级为变更页横幅 + 命令面板角标；
- 三键：**批准 / 驳回 / 本会话记住**（仅 Session 档可记住；EachTime 档按钮不出现）；
- 队列积压指示：任务卡/状态栏"N 项待确认"，会话进入 `AwaitingPermission` 徽标态（§12.4 状态机既有）；
- 人自己的操作不走队列（既有交互不变）——**队列只是 agent 写请求的排队形态**，策略同一张目录表。

### 4.2 溯源与审计分离

- **进 git 数据的**（沿 §5.2 既有规范，不扩）：`Assisted-by: <agent-id>` + `Gitter-Session: <uuid>`。MCP 通道的 agent 身份取自握手 clientInfo（如 `cursor`/`claude-code`）；harness 通道取 manifest `identity.assistedBy`；宿主托管 checkpoint 由 Gitter 代打（§12.9）；
- **不进 git 数据的**（通道、确认人、耗时等过程信息）：写 `.git/gitter/audit.jsonl`（append-only），一行一操作：`{ts, source, agentId, op, args 摘要, decision, durationMs}`。审计是融合的可信底座——出问题时"谁在何时经哪条通道动了什么"有账可查；
- 原则 1.2-2 复述：**无人工确认不落盘**（Auto 档只覆盖读与宿主 checkpoint 这类可整体关闭的操作）。

### 4.3 诚实边界（不伪装强隔离）

agent 绕过 Gitter 直接跑 git（进程内自有行为）不受管线约束——既定对策不变：Codex sandbox 默认 workspace-write + preamble 软约束 + 验收台 trailer/时间窗弱标注兜底（agent-harness-codex.md §八）。工具面管"经 Gitter 的"，验收台管"没经 Gitter 的"，两层防线各司其职。

---

## 五、读路径融合：验收级视图作为 agent 工具（含本稿核心新增）

### 5.1 差异化：不给裸 git，给验收视图

agent 直接跑 `git diff` 能拿到文本，Gitter 的读工具价值在于**已经整理过的验收视角**：`review.session_diff`（squash 视角的会话净 diff）、`review.risk_signals`（规则引擎标注的风险 hunk）、`repo.impact`（影响面）。agent 拿到的是"人将看到什么"，而不是原始字节流——这是命题 1 的差异化落点，也是 Gitter 作为 agent 基础设施的护城河。

### 5.2 `review.state`：验收三态的人机双向共享（本稿核心新增）

- **数据**：hunk / 文件 / 整体三层的三态（`pending / accepted / rejected`）+ 可选的反馈批注引用（ReviewFeedback id）；
- **存储**：会话内存 + 任务账本（`.git/gitter/agent-tasks.json` 同目录），**不写入 git 数据**（沿 §九"AI 输出不进仓库"，裁决是过程数据）；
- **不对称访问**（目录中的 `Hidden` 设计）：人经 UI 读写（`review.state.write` 对 agent 隐藏），agent 经 MCP/harness **只读**（`review.state.read`）；
- **时效**：附 `baselineSha` + hunk 指纹（内容 hash），agent 拿到的状态自带版本——人改了代码或基线推进后旧裁决自动失效，agent 不会拿过期裁决当指令；
- **闭环价值**：`codex exec resume` 修复轮里，agent 先查 `review.state` → 只处理 `rejected` 的 hunk + 反馈文本 → 改动面积最小化。命题 3 的"人的裁决成为 agent 输入"即此。

### 5.3 隐私与本地性

读工具只经本机 stdio / 命名管道暴露（§7.2 既有传输决策），不出网；风险信号与 diff 内容离开本机的唯一途径是 agent 自己的模型端点——在 MCP 握手文档与设置页明示，不与 §8.2 隐私三档混淆（那三档约束 IAiGateway，不约束 harness/MCP 本地通道）。

---

## 六、闭环：两通道、一状态

人的裁决与反馈通过**两个通道**喂给 agent，但状态只有**一份**（`review.state` + ReviewFeedback 列表）：

| 通道 | 形态 | 时机 |
|---|---|---|
| 推 | harness `SubmitFeedbackAsync`（NextTurn：exec resume 起反馈轮） | 人点"退回重做"，agent 会话在场 |
| 拉 | MCP `review.submit_feedback` / `review.state.read` | agent 主动查询（会话不在场，或 agent 自主循环中） |

时序（旗舰场景）：人标 rejected + 写反馈 → 推通道起修复轮；修复轮中 agent 拉 `review.state` 核对剩余 rejected 项 → turn.completed → 宿主 checkpoint → 人继续审。两通道写同一状态存储，不出现"反馈双份、裁决两套"。

---

## 七、终端与 CLI 出口（第三投影的兜底）

- **`gitter` CLI 子命令面**：`gitter mcp serve`（§7.2 既有规划）、`gitter repo <op>`、`gitter session <id> status`、`gitter task list`——同一目录的文本投影。价值：不能挂 MCP 的 agent（脚本、CI 里的 agent、老工具）仍有结构化出口，且**同样过管线**（无头环境下 Session 确认降级为 `--yes` 显式旗标 + 审计标记 `unattended`）；
- 活动感知（§7.3）反哺工具面：终端模式识别产生的状态推断，与 harness 事件、watcher 事件在任务卡汇合同一份数据——三个信号源，一个视图。

---

## 八、场景走查（融合咬合点标注）

**场景 1：旗舰闭环（harness 在场，Codex）**
新建任务（`repo.worktree.write`，Session 确认）→ 派活（harness，不涉目录）→ Codex 改文件（绕过 Gitter，sandbox 兜底）→ 轮次结束 → `task.checkpoint`（Hidden 出口，宿主代打，trailer 齐全）→ 人审：接受（`repo.apply_patch`）→ `review.state` 置 accepted；退回（reverse apply + 反馈）→ 置 rejected → 推通道直投 → Codex 拉通道核对剩余 rejected → 修复 → 满意后"整理为一次提交"（`repo.history.write`，EachTime 确认，影响面数据来自 `repo.impact`）→ 合并清理。**每一步人与 agent 都在咬合同一张目录。**

**场景 2：纯 MCP 客户端（不经 harness，如 Cursor）**
agent 调 `repo.diff` + `review.risk_signals` 自查 → 调 `repo.stage`（Session 档，首次弹内联卡，记住）→ 调 `repo.commit`（安全网拦截：发现疑似密钥 → 阻止 → agent 收到结构化错误改写 message 去掉密钥行 → 二次提交 → 人批）→ 提交带 `Assisted-by: cursor` + `Gitter-Session`（握手 clientInfo 提供身份）→ 审计入账。**没有 harness、没有任务卡，融合依然成立——这就是"出口 agent 化"独立于宿主的价值。**

**场景 3：agent 全部离场（降级守卫）**
目录中 Hidden/RW 标注不影响任何 UI 操作；确认队列空；审计无 agent 行；MCP server 关闭。Gitter 表现为今天的完整客户端。守卫测试断言：禁用全部 harness 包 + 关闭 MCP 后，UI 出口对每个 Operation 的行为与未引入工具面之前逐项一致。

---

## 九、明确不做

- 不做 agent 编排/工作流引擎、多 agent 调度、agent 间通信（Gitter 不成为 agent 框架）；
- 不做工具的 agent 自主发现协议之外的"动态注册"——目录静态、可审计、随版本发布；
- 不把裁决状态、审计、反馈写进 git 数据（trailer 白名单之外零污染，沿 §九）；
- 不为 agent 开放任何 `Hidden` 操作的"特权模式"；`EachTime` 无记忆后门；
- 不做 MCP 之外的第三方工具协议适配（LSP 等）——需要时它们也只是目录的新投影。

---

## 十、落地切片（F 系列）与测试

| 阶段 | 交付 | 对齐既有路线 | 依赖 |
|---|---|---|---|
| **F0 目录与策略模型** | `GitUI.Core/Tools`：Operation 模型 + 首批目录（§3.2 表）+ 执行管线骨架（确认/安全网/溯源挂点）；**UI 出口先切过去**（行为不变） | 随 P1（安全网同库落地） | 无 |
| **F1 读出口** | MCP server（stdio）暴露全部读操作 + `review.state.read` | 即 P5 的具体化 | P0（watcher 保状态新鲜）、P5 管道层 |
| **F2 写出口与确认队列** | 写操作经管线；Session/EachTime 确认；审计 audit.jsonl；provenance 打戳；harness `gitWrite` 收敛为操作 id 引用 | 补全 P5 + 修订 §12.3（v1.3 备注即可） | F1、C1 账本 |
| **F3 裁决回流与 CLI** | `review.state` 双向（UI 写 / agent 读 + 时效指纹）；反馈推/拉两通道合一；`gitter` CLI 子命令面 | 即 C2 衔接 | F2、C1（NextTurn 反馈） |

**测试策略**（延续仓库守卫风格）：目录 schema 与不变量黄金用例（Hidden 拒绝 / EachTime 无记忆 / 读零确认）；确认策略与 Session 记忆范围纯函数化；管线各挂点（安全网命中、溯源戳字段、审计行格式）快照测试；MCP 协议层单测（既有 §十 规划）；**降级守卫**（场景 3 的逐项一致断言）；`review.state` 时效指纹的过期失效参数化测试。

---

## 十一、与既有文档的关系

| 文档/章节 | 关系 |
|---|---|
| ai-native-redesign.md §7.2（MCP 工具集） | **被吸收**：工具清单改由操作目录生成（F1） |
| ai-native-redesign.md §12.3（harness manifest） | **后续收敛**：`gitWrite` 白名单改引用操作 id（F2）；其余不动 |
| ai-native-redesign.md §3.4（hunk 三态） | **被吸收**：三态即 `review.state` 的数据源，存储与时效在此定义 |
| ai-native-redesign.md §4.2（安全网） | **位置重定义**：从"提交时机的功能"改为"写管线拦截器"，规则库不变 |
| ai-native-redesign.md §12.9（宿主 checkpoint） | 引用：`task.checkpoint` 即其 Hidden 出口形态 |
| agent-harness-codex.md | 引用：场景 1 的 harness 侧细节、sandbox 边界（§八）、NextTurn 反馈（C1） |
| 两文档的定位宣言 | **不漂移**："AI 生产，人验收，Gitter 管理验收台"——工具面让这句话对人机同时成立 |

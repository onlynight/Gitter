# 任务页 v3.3:任务收尾闭环与列表管理设计

> 状态:已落地(2026-10-12,后端 + 前端 + smoke-agent-wrapup 冒烟全绿) · 范围:P0 修订版
> 原型:[../design/task-wrapup-list-mockup.html](../design/task-wrapup-list-mockup.html)(交互式:顶栏 chips 切换六个场景,双主题)
> 上游:[task-page-v2-design.md](task-page-v2-design.md)(信息架构) · [agent-harness-v4.md](agent-harness-v4.md)(会话/账本) · [task-page-live-changes.md](task-page-live-changes.md)(变更面板)
> 裁决:
> 1. **单项目单窗口是有意设计**——列表管理只做单仓库内的搜索/筛选/分组/归档,不引入项目维度(多仓库分组不做)。
> 2. 合并闭环只服务 worktree 任务(`settings.agentsTaskWorktree=true`);主 worktree 任务(默认模式)收尾 = 去变更页提交,不做合并。
> 3. 合并默认 **squash 单提交**;`--no-ff` 保留检查点轨迹为高级选项(合完仍可去 Log 页 squash)。
> 4. **状态机不加新枚举值**——「已完成 / 待处理」的区分用附加字段 `awaitKind` 派生,`completed` 死值不启用。

---

## 一、背景与范围

对标 ZCode/Codex 的 P0 差距修订后剩三条工作流:

| 工作流 | 内容 | 现状缺口 |
|---|---|---|
| **A 列表管理** | 搜索、状态筛选、日期分组、归档查看/恢复、重命名、删除 | 列表仅「状态点+标题+分叉/归档」两动作(TasksPage.tsx:1104-1126);无搜索/筛选/分组;delete 有 API 无 UI;archive 无恢复入口;rename 无 API |
| **B 收尾闭环** | worktree 任务完成后合并回基线分支 + 清理 | 任务结束只停在与 ask_user 同值的 `awaiting-input`,worktree/`task/*` 分支永久残留,合并需用户手敲 git |
| **C 半成品收尾** | 后台 shell 页签、验收反馈入口 | `agent.task.shells`(bridge.ts:556)与 `agent.task.feedback`(bridge.ts:524)后端完整,UI 零消费 |

不做(本期):PR 创建(GitHub API/gh 依赖,后续独立稿)、云任务、Best-of-N 多方案、消息级 rewind。

---

## 二、工作流 A:列表管理

### 2.1 信息架构

```
┌─ 任务列表列 ────────────────────┐
│ ＋ 新任务(描述目标,Ctrl+N)      │
│ ┌────────────────────────────┐ │
│ │ 🔍 搜索标题 / 摘要 / id     │ │ ← 新增,常驻
│ └────────────────────────────┘ │
│ [全部 12] [进行中 2] [待处理 1] │ ← 新增筛选 chips(横向,可溢出滚动)
│ [已完成 8] [失败·中断 1]        │
│ ── 今天 ────────────────────── │ ← 新增分组头(细线+文案)
│ ● 修复登录页 CSS  [⑂][⬆][🗑]   │ ← 行尾悬停 3 动作(原 2 + 删除)
│ ● 重构 session 恢复             │
│ ── 昨天 ────────────────────── │
│ ✓ 完成 xx 导出功能              │  ✓ = 已完成点色
│ ── 更早 ────────────────────── │
│ ⏸ 修复 worktree 竞态            │
│ ─────────────────────────────  │
│ ▸ 显示已归档 (3)               │ ← 新增底部折叠开关
└────────────────────────────────┘
```

### 2.2 搜索

- 输入即过滤(150ms 去抖),**纯前端**,零新 RPC:命中范围 `title` / `lastMessage` / `taskId` 前 8 位,大小写不敏感。
- 清空钮;无命中显示空态「无匹配任务」(替代空账本提示行)。

### 2.3 列表工具条(v3.4 修订:chips 收进图标下拉)

> v3.4(2026-10-12,按 design/task-wrapup-list-mockup.html 落地):原五个筛选 chips 收进**筛选图标下拉**,
> 工具条为搜索框下方右对齐三图标钮(对齐 ZCode 列表头):**排序(⇅)/ 筛选(漏斗)/ 批量归档(归档箱)**。

**筛选下拉**(漏斗钮,向下弹出,点外关闭):每项 = ✓选中标 + 状态色点 + 计数;状态集合与下表一致:

| 项 | 状态集合 |
|---|---|
| 全部 | 非归档全量 |
| 进行中 | `starting` `working`(色点绿) |
| 待处理 | `awaiting-permission` + `awaiting-input`(awaitKind≠null)(色点琥珀) |
| 已完成 | `awaiting-input`(awaitKind=null)+ `completed` |
| 失败·中断 | `failed` `interrupted` `stopped` |

- 选中态持久化 `localStorage.gitter.taskListFilter`;默认「全部」。计数随归档/恢复实时刷新(纯前端现算)。

**排序下拉**(⇅ 钮):最近活动(默认,账本次序)/ 创建时间(新→旧)/ 标题 A→Z;组内排序,日期分组不变;持久化 `localStorage.gitter.taskListSort`。

**批量归档**(归档箱钮):点击进入选择态——工具条换操作条「已选 N 项 | 全选 | 归档 | 取消」,行首出现勾选框,行点击=勾选,悬停快捷区/重命名隐藏,已归档行隐身且不可勾;「归档」= 循环 `agent.task.archive { archived: true }`,完成后退回列表更新计数。

### 2.4 日期分组

- 按 `lastActiveAt ?? createdAt` 分四组:**今天 / 昨天 / 近 7 天 / 更早**;组头 = 细分隔线 + 左侧 11px 灰字。
- 组内默认账本顺序(`upsertTask` unshift,新→旧,tasks.ts:103-107);v3.4 排序(§2.3 排序下拉)在组内生效,分组本身不变。
- 搜索/筛选命中为空的组不渲染组头。

### 2.5 归档查看与恢复

- 数据源:`agent.tasks` 透传 `includeArchived: true` 一次性拉全(仓库内任务量级小)。bridge 现为 `R("agent.tasks", () => this.agents.listTasks())`(bridge.ts:516)未透传——一行改动 `R("agent.tasks", (args) => this.agents.listTasks(args ?? {}))`,listTasks 已支持该参(session.ts:202-214)。
- 底部「显示已归档 (N)」折叠开关(持久化 localStorage);展开后归档任务 60% 透明度混入各自日期组。
- 归档行尾动作变为:**恢复**(调 `agent.task.archive { archived: false }`,API 已有,session.ts:549-560)+ 删除;归档任务不参与「待处理」计数。

### 2.6 rename 与 awaitKind

**重命名**:双击行标题 → 行内 input(Enter 提交 / Esc 或失焦取消);live 任务也允许(纯展示字段)。新 RPC:

```
agent.task.rename { taskId, title } → AgentTaskRecord
```

- 实现:`needRepo` + record 查找 + `title = trimmed 截 60`(对齐 spawn 规则 session.ts:276)+ 写账本 + `agent.tasks.changed`。
- fork 的 slug 不受影响(分支名创建时已定,session.ts:283-285)。

**awaitKind(区分「等你回答」与「已完成」)**:现状 ask_user(session.ts:1433)、plan_submit(1449)、自然收尾(1201)三路共享 `awaiting-input`,列表与 OS 通知(bridge.ts:176-178 文案即「已完成」)全部无法区分。方案:`AgentTaskRecord` 增可选字段:

```ts
/** 进入 awaiting-input 的原因:null = 自然收尾(已完成) */
awaitKind?: "question" | "plan" | null;
```

- ask_user 抛出 → `"question"`;plan_submit → `"plan"`;`replyPermission` 结算(session.ts:222-250)与 resume/queue 续轮时清 `null`。
- 持久化随账本;旧记录无字段视为 null(= 已完成),零迁移。
- UI:`stateChip` 对 `awaiting-input` 细分——question「等你回答」/ plan「待确认计划」/ null「已完成」,点色同现状。

---

## 三、工作流 B:收尾闭环(合并回基线)

### 3.1 适用判定与 baseBranch

- **worktree 任务**:`record.worktreePath !== repo && record.branch.startsWith("task/")` → 走合并流。
- **主 worktree 任务**(默认模式,`agentsTaskWorktree=false`):改动直接落在当前分支工作区,无合并语义——收尾条显示「在变更页提交」引导钮(跳 Changes 页),不做合并。
- **baseBranch 记录**:`AgentTaskRecord` 增可选字段 `baseBranch?: string`:
  - spawn 时记录(session.ts:282-293 处,worktree 分支创建旁):worktree 模式下取主 worktree 当前分支(`rev-parse --abbrev-ref HEAD`);主 worktree 模式不记(用不到)。
  - fork 复制源的 baseBranch(session.ts:506-547 处)。
  - 旧记录缺失:mergeCheck 兜底 = 主 worktree 当前分支,对话框内可改选(本地分支下拉,gitbranches.getBranches)。

### 3.2 流程总览

```
[收尾条]「⇤ 合并到 dev」
   │
   ├─► agent.task.mergeCheck  (对话框打开时调用)
   │     ├ 任务 live?           → MERGE_TASK_LIVE 拒绝
   │     ├ 主 worktree 脏?      → MAIN_DIRTY(引导:先去变更页处理)
   │     ├ 任务 worktree 未提交 → 计数 uncommitted(合并时自动 checkpoint)
   │     ├ ahead/behind         → rev-list --left-right --count base...task
   │     ├ 冲突预检             → git merge-tree --write-tree --name-only base task
   │     │                        (git < 2.38 兜底:临时 worktree 试合并→abort→删,§3.6)
   │     └ 差异预览             → diff --stat $(merge-base base task) task
   │
   ├─► 合并对话框:策略(squash/no-ff) · 提交消息(预填标题) · diffstat · 冲突清单 · 清理勾选
   │
   └─► agent.task.merge
         ├ 重跑检查(防 mergeCheck 后竞态)
         ├ 任务 worktree 有未提交改动 → commitCheckpoint("收尾提交")
         │                              (复用 checkpoint.ts:30,trailer 自动齐)
         ├ squash:git merge --squash task/xxx + git commit(消息含 trailer)
         │  no-ff:git merge --no-ff -m <msg> task/xxx
         ├ 写 record.wrapup { mergeSha, mergedAt, strategy } → agent.tasks.changed
         └ cleanup(勾选时):git worktree remove + git branch -d task/xxx + archived=true
```

### 3.3 合并策略

| | squash(默认) | merge --no-ff |
|---|---|---|
| 基线分支历史 | 1 个干净提交 | N 个 checkpoint 提交 + merge 节点 |
| 适用 | 常规收尾 | 想保留 agent 过程轨迹 / 事后在 Log 页归组 squash |
| 提交消息 | `<任务标题>`(可编辑) | `merge: <任务标题>`(可编辑) |
| trailer | 均附 `Assisted-by: gitter-agent` + `Gitter-Session: <taskId>`,与 checkpoint.ts:38-40 同格式——Log 页会话归组语义延续 | 同左 |

- ahead=0(agent 无产出)时对话框显示「无差异」,合并钮禁用。
- squash 借道 `merge --squash`(索引合入不产提交)+ 显式 `git commit`,消息/trailer 完全可控;封装进 gitbranches 新函数(§3.7)。

### 3.4 冲突路径

`mergeCheck` 返回 `conflicts: string[]`(非空)时,对话框禁用「合并」,展示冲突文件清单,给出两条出路:

1. **让 Agent 解决冲突**(推荐):「解决冲突」钮 → `agent.task.resume`,受限提示模板:
   > 基线分支 <baseBranch> 已前进,与任务分支产生冲突(文件:<清单>)。请在任务 worktree 内执行 `git merge <baseBranch>`,逐个解决冲突(以基线侧为准除非任务侧有意修改),完成后提交并简要汇报解决方式。
   完成后用户重新打开对话框 → mergeCheck 重检 → 通过则合并。
2. **放弃合并**:关闭对话框,任务原状保留。

### 3.5 UI 挂接

- **收尾条**:chat 页 pagehead(tk-pagehead,TasksPage.tsx:1193-1210)下沿一行,出现条件 = 选中任务非 live && 有独立 worktree && `diffCount > 0` && 无 `record.wrapup`。内容:「⇤ 合并到 <baseBranch>」primary 钮 +「查看改动」ghost(切 diff 页签)。合并完成 → 收尾条变「已合并 <sha8>」chip,点开 Log 页可看。
- **ChangesTab 头部**(TaskDetailPages.tsx:17)加同款次级入口(收尾条被关掉时仍可达)。
- **合并对话框**:新文件 `web/src/pages/TaskWrapupDialog.tsx`——TasksPage 已 1472 行,按 TaskChangesPanel/TaskDetailPages 惯例独立成文件。布局:目标分支行(可改下拉 + 主 worktree 当前分支不一致时琥珀提示)、策略单选、消息输入、diffstat 折叠块(等宽字体,展开/收起)、冲突块(红字清单 + 解决冲突钮)、清理勾选(默认勾选;worktree 有未提交改动时保持可勾——会先自动 checkpoint)。
- 合并/清理后任务归档,从列表消失(「显示已归档」里可见,可删除记录)。

### 3.6 冲突预检的 git 实现细节

- **首选** `git merge-tree --write-tree --name-only <base> <task>`(Git ≥ 2.38):exit 0 = 首行为 tree oid 无冲突;exit 1 = 首行 tree oid + 其余行为冲突文件清单;其他退出码视为不可用。
- **兜底**(老 git):`git worktree add --detach <tmp> <base>`(tmp 置 `%LOCALAPPDATA%\GitUI\tmp\`,worktrees.ts:42 同区)→ `git merge --no-commit --no-ff <taskBranch>` → `git diff --name-only --diff-filter=U` 取清单 → `git merge --abort` → `git worktree remove --force <tmp>`;全程 tryGit,任何一步失败 → `conflicts: null`(无法预检)。
- `conflicts: null` 时对话框降级:警告「无法预检冲突,直接合并可能中途冲突」仍允许执行;实际合并撞冲突 → `git merge --abort` + 返回冲突清单(等价预检结果)。

### 3.7 后端模块

- **新文件 `app/src/services/agents/merge.ts`**:`mergeCheck(args): MergeCheckDTO` + `mergeTask(args): MergeResultDTO`,依赖注入 record 查找 / checkpoint / settings(与 session.ts 同套 deps 风格),挂在 AgentSessionManager 上(`this.agents.mergeCheck(...)`),运行中拒绝复用 archive/delete 的 live 判定(session.ts:551、564 同款)。
- **gitbranches.ts 增** `squashMerge(workDir, branch, message, target?)`(与 mergeBranch 185-194 并排):target 非当前分支先 checkout target → `merge --squash <branch>` → `commit -m <msg>`;冲突时 `merge --abort` 后抛 GitError(detail 带冲突清单)。
- **worktree/分支清理复用**:`removeTaskWorktree`(worktrees.ts:63-66,无 --force;自动 checkpoint 已保证 worktree 干净,普通 remove 可过)+ `gitbranches.deleteBranch`(180-183)。

---

## 四、工作流 C:半成品收尾

### 4.1 后台 shell 页签

- 页签数组(TasksPage.tsx:1180-1186)增第四项 `["shells", "后台", N]`;N = 运行中 shell 数,选中任务 live 时随现有 5s stats 轮询(TasksPage.tsx:571-582)顺带拉 `agent.task.shells`,live 外不清零(保尾值)。
- **ShellsTab**(TaskDetailPages.tsx 新增导出,与 ChangesTab/CheckpointsTab 同款 props):每行 = 状态点(运行琥珀脉冲/退出码绿红)+ command(截 200)+ 时长;行下 `<pre>` 展示 `tail`(≤2000 字符,`agent.task.shells` 已裁);页签打开时 2s 轮询刷新;每行「终止」钮(运行中才可用)。
- **新 RPC** `agent.task.shellKill { taskId, shellId } → { ok }`:session 从 registry 找 ShellRecord → `taskkill /pid <pid> /T /F`(与超时路径同款,builtinTools.ts:648-651 先例)→ `running=false`;找不到/live 外 → 报错。
- 空态:「重启后后台 shell 不保留」(ShellRecord 仅 live,session.ts:877-884 返回 [])。

### 4.2 验收反馈入口

- pagehead 新增 ghost 钮「验收反馈」(live 时禁用)→ 小对话框(textarea,必填非空)→ `agent.task.feedback { taskId, feedback }`(bridge.ts:524 已有,零后端改动)。
- 对话框底部说明文案:「反馈将作为新一轮启动,Agent 只处理反馈条目」——如实描述现行为(session.ts:439-447:受限提示 + resumeTask,会脱离归档、state=starting)。
- `review_get_state` / feedback.json 读取侧(供 agent 主动查)不在本稿范围。

---

## 五、数据结构与 RPC 汇总

**AgentTaskRecord 新增可选字段**(types.ts:130-172,全部向后兼容):

```ts
baseBranch?: string;                                  // spawn/fork 时记录(§3.1)
awaitKind?: "question" | "plan" | null;               // awaiting-input 细分(§2.6)
wrapup?: { mergeSha: string; mergedAt: string; strategy: "squash" | "merge" };  // §3.2
```

**RPC 变更**:

| RPC | 类型 | 签名 |
|---|---|---|
| `agent.task.rename` | 新 | `{ taskId, title } → AgentTaskRecord` |
| `agent.task.mergeCheck` | 新 | `{ taskId } → MergeCheckDTO` |
| `agent.task.merge` | 新 | `{ taskId, strategy: "squash"\|"merge", message?, cleanup? } → MergeResultDTO` |
| `agent.task.shellKill` | 新 | `{ taskId, shellId } → { ok }` |
| `agent.task.delete` | 扩展 | 增 `cleanup?: boolean`(默认 true):best-effort 清 worktree+task 分支(tryGit,失败静默,删除本身不受影响) |
| `agent.tasks` | 扩展 | bridge 透传 `includeArchived`(§2.5,一行) |

**新 DTO**(web/src/bridge/types.ts 镜像):

```ts
interface MergeCheckDTO {
  ok: boolean;
  reason?: "TASK_LIVE" | "MAIN_DIRTY" | "GIT_FAIL";
  baseBranch: string;        // 解析后目标(record.baseBranch ?? 主 worktree 当前)
  mainBranch: string;        // 主 worktree 当前分支(≠ baseBranch 时 UI 提示)
  mainDirty: boolean;
  ahead: number;             // task 领先 base 提交数(0 = 无差异,禁合并)
  behind: number;            // base 领先数(>0 才有冲突风险)
  uncommitted: number;       // 任务 worktree 未提交文件数(合并时自动 checkpoint)
  conflicts: string[] | null;// null=无法预检 []=干净 非空=冲突清单
  diffStat: string;          // diff --stat 原文(预览)
}
interface MergeResultDTO {
  ok: boolean;
  mergeSha?: string;
  conflicts?: string[];      // 实际合并撞冲突(已 abort)
  cleanup?: { worktreeRemoved: boolean; branchDeleted: boolean };
  archived: boolean;
}
```

---

## 六、兼容性与迁移

- **账本 version 1 不动**:三个新字段全可选;listTasks 归一化层(session.ts:202-214)补默认即可。
- **state 枚举不动**:`completed`(types.ts:146)维持死值不启用;「已完成」判定 = 非 LIVE_STATES 且 awaitKind 为 null,所有消费方(UI chip、OS 通知、extension 包)无感。
- **旧任务无 baseBranch**:mergeCheck 兜底主 worktree 当前分支 + 对话框可改选(§3.1)。
- **删除清理失败**(worktree 被其他窗口 Files 页占用、分支在别处 checkout):记录照删,结果 toast「worktree/分支清理失败(可能被占用),可到 Worktree 页手动移除」。
- **git 版本**:merge-tree 探测失败自动走临时 worktree 兜底(§3.6);两路都不可用则预检降级,不阻断合并。

---

## 七、验收清单

1. 搜索「session」只显示标题/摘要/id 命中的任务;清空恢复;筛选+搜索叠加生效。
2. ask_user 挂起的任务落在「待处理」,自然完成的落在「已完成」——两者不再同显「Awaiting input」。
3. 归档任务经「显示已归档」可见(半透明),恢复后回到正常列表原日期组。
4. 双击重命名:列表、详情 pagehead、悬停 title 三处即时一致;重启后保持;live 任务可改名。
5. 删除任务(勾选清理):账本条目、`<taskId>.json`、journal 目录、worktree 目录、`task/*` 分支全部消失;不勾选时后两者保留。
6. worktree 任务完成后:收尾条出现 → squash 合并 → Log 页出现单条带 `Gitter-Session` trailer 的提交 → 任务归档消失 → worktree/分支已清理。
7. base 前进产生冲突:对话框列出冲突文件;Agent 解决冲突并续跑完成后重检通过,合并成功。
8. ahead=0(任务无产出)时合并钮禁用并显示「无差异」。
9. 主 worktree(默认模式)任务:收尾条只有「去变更页提交」,mergeCheck/merge 不可达。
10. 后台页签:长跑 `terminal_run` shell 的 tail 实时可见、可终止;重启后打开为空态。
11. 验收反馈提交后任务重启新轮,时间线首条出现受限审查提示,Agent 只回应反馈内容。

---

## 八、实现映射备注

| 文件 | 改动 |
|---|---|
| `app/src/services/agents/types.ts` | AgentTaskRecord 三字段 + MergeCheckDTO/MergeResultDTO |
| `app/src/services/agents/session.ts` | awaitKind 三处读写(1433/1449/222-250);spawn 记 baseBranch(282-293);fork 传承(518-522);rename/mergeCheck/merge/shellKill 方法;deleteTask 增 cleanup(562-578) |
| `app/src/services/agents/merge.ts` | **新文件**:mergeCheck + mergeTask(§3.6/§3.7) |
| `app/src/services/agents/registry.ts` | ShellRecord 补 pid 暴露(kill 需要;现仅 id/command/output,59-66) |
| `app/src/services/gitbranches.ts` | squashMerge(§3.7) |
| `app/src/bridge.ts` | 5 个新/改 RPC 注册(agent 区,516-561);agent.tasks 透传 |
| `web/src/bridge/types.ts` | DTO 镜像 + AgentTaskDTO 补 baseBranch/awaitKind/wrapup |
| `web/src/pages/TasksPage.tsx` | 列表列:搜索框/chips/分组头/归档开关/行内重命名/删除确认;pagehead:收尾条 + 验收反馈钮;tabs 数组加 shells |
| `web/src/pages/TaskWrapupDialog.tsx` | **新文件**:合并对话框(§3.5) |
| `web/src/pages/TaskDetailPages.tsx` | ShellsTab 导出 + ChangesTab 头部合并入口 |

- **冒烟**:按 smoke-agent-v4.ts 惯例新增 `smoke-agent-wrapup.ts`:临时仓库 → worktree 任务 → 制造改动与 base 前进 → mergeCheck 冲突路径 → agent 侧解决 → squash 合并 → 断言账本 wrapup/清理/Log trailer。
- **工作量粗估**:后端 A(含 awaitKind)0.5d · B 1.5d · C 0.5d;前端 A 1d · B 1d · C 0.5d。
- **风险点**:merge-tree `--name-only` 输出解析(首行 tree oid);`merge --squash` 在索引残留时的防御(合并前 `git reset --hard` 校验?不——任务 worktree 由 checkpoint 兜底,主 worktree 侧 MAIN_DIRTY 已拦截);Windows `git worktree remove` 对长路径的兼容(现有 worktrees.ts 已有同路径实践)。

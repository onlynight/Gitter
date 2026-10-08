# Gitter Agent Harness v4.0 —— 完整 AI 编程工具化设计

> 状态：设计提案 v4.0（2026-10-07）
> **实施进度（2026-10-07，当日完成核心实现）**：B1–B6 主体落地——消息回写（P0 修复，经实证 ai@7 出口为 `result.responseMessages`）/ journal 分段 / 会话文件 v2 / async IO / fork 独立 worktree / 重试退避；工具面单源（agents/registry.ts，19 个内置工具经 registerAgentTool 自举，插件 ctx.registerAgentTool 同接缝）；read v2 行号分页 / glob / grep(rg 优先) / 写前读校验 / patch 批量原子 + 相似位置提示；plan/default/yolo 三模式 + 持久规则引擎 + 授权卡结构化 payload + commandRisk；自动压缩（user 边界切点）+ /compact /clear + 上下文用量条；todo / plan_submit（批准自动续执行轮）/ ask_user / 排队投递；explore/act 子代理（同步并发、深度 1、级联中止）；改动预览三页签（文件列表+DiffView / checkpoint 恢复）。设置页 Agent 权限规则管理 + 压缩模式/子代理上限 + 聊天 @ 提及浮层 + 新 RPC 权限域分级（smoke-u2 回归绿）。**编排端到端验证（smoke-agent-e2e，脚本化 LanguageModel + 真 git 临时仓库）7 场景全绿：E1 消息回写序列 user→assistant→tool→assistant（P0 实证）/ E2 读→patch 落盘+checkpoint / E3 前缀规则门拦截 / E4 ask_user 回答回传 / E5 plan 批准→模式切换→自动续执行轮（写出文件+todo+planHistory）/ E6 子代理结论回传 / E7 排队投递注入续轮**。全套 smoke（smoke/extensions/u2/seams/v4/e2e）全绿；遗留：L3 沙箱循环维持封存（按 §14.1 触发条件启动）
> 定位：在 v3.0（自身即 agent 运行时，A1–A4 已落地）基础上，把 Gitter Agent 从"一个能对话的框"补齐为对标完整 Codex / ZCode 的 AI 编程工具——能读写项目、用工具干活、压缩上下文、预览与回滚每一次编辑
> 关系：继承 v3.0 全部底座（事件族 / 任务账本 / 授权卡 / 托管 checkpoint / 任务卡两栏 UI / 任务型与模型档案链）；**推翻 v3.0 §十一"不做子代理 / plan 模式"的边界裁决（v4 正式纳入）**；吸收 tool-agent-fusion.md D 阶段（Agent 循环消费统一 ToolRegistry）
> **补充 v4.1（2026-10-07，同日）：全插件化设计（§十四）**——用户裁决"重要的是全插件化"：Agent 能力面 100% 贡献点化，内置能力与第三方插件走同一批接缝（内置自举注册、同槽位竞争），原则是"**数据可插件，引擎不插件**"
> **补充 v4.2（2026-10-07，同日）：plan 模式与子代理为 v4 必达能力**——§九/§十 深化为完整分册：plan 全生命周期（调研→提交→批准→执行衔接→修订链）、子代理同步并发模型（AI SDK 并行 tool-call + 信号量限流）、权限矩阵、plan×子代理联动（规划期只许 explore）
> **补充 v5.0（2026-10-07，同日）：Agent 全阶段插件化（§二十，最新裁决）**——用户裁决"agent 实现不是单纯的页面插件化，要把 agent 的**全部阶段**都开放出来插件化，用户要能完全自定义"。§二十对一轮 turn 的完整流水线 T0–T12 逐阶段盘点差距（含代码证据：三处接缝残缺、八处硬编码、一处 P0 级假授权门），给出十条新接缝的完整契约、内置实现自举改造清单与 C1–C7 实施路线；原则从"数据可插件，引擎不插件"细化为"**编排可插件，裁决不迁移**"。§二十是 §十四 的替代与深化，两者冲突处以 §二十 为准
> **C 系列实施进度（2026-10-07 第三轮，C1–C6 主体落地）**：C3-P0 假授权门真闭环（loopAdapter 经 LoopOptions.services.requestPermission 真挂起真回执，无服务面时安全缺省拒绝）+ ctx.registerLoop 升级 v2 契约（LoopOptions 直注册统一注册表）；C1 提示词槽位化（seams 12 槽枚举 + boundary 锁死非内置拒注册 + 九内置段自举 + composeSystemPrompt/SubagentPrompt/compactionSystemPrompt 全部改槽位渲染 + 尾部双锚定行）；C2 contextFiles L1 数据注入 + 采集器 3s 超时 + 压缩数据面调参（settings.agentsCompactionPolicy）+ taskType.compactor 选择链 + validateMessageSequence 宿主校验与 turn 末自愈；C4 commandRiskRules（max 只上调）/agentPermissionRules（deny-only 包声明）数据化 + ctx.registerSubagentPreset + 预设编译校验收紧（readonly⇒只读工具面、timeout≤600s）；C5 EVENT_NAMES 扩展五事件 + agent.tool.called 载荷最小化（去 args 明细）+ turn.completed 带 usage/durationMs + post-turn turnHooks（2s 超时、cap 2000、system-reminder 注入下一轮、settings 总开关）；C6 agent.command 会话命令页内模板展开 + 任务页斜杠补全动态列出包命令；渲染层 registerAgentUI/timelineRenderers/composerProviders/@多前缀（§14.6 已落地）。smoke 扩展至 57 项（boundary 锁死/规则只上调/序列校验自愈/E8 钩子注入新场景）；示例包扩展 contextFiles/commandRiskRules/agentPermissionRules/agent.command。**未完成（下一轮）**：设置页"提示词段/采集器/钩子"三审计视图、内置十类渲染器迁移注册表（第 2 期）、内置斜杠命令数据化自举、todo 防腐改造为内置钩子（暂留引擎，钩子接缝已开）、F10.3 图片输入进模型上下文
> **实际插件化落地（2026-10-07 第四轮）**：内置 agent 能力真实包化——**agent.builtin.prompts**（boundary/context/workflow/tools/output/compaction/subagent 七段 L1 模板化，`{{worktree.path}}/{{branch}}/{{status}}/{{mode}}` 引擎侧插值；boundary 仅随应用分发的内置包可写，用户包声明在 sync 拒绝 + registerPromptSection 双重防线）与 **agent.builtin.presets**（explore/act 数据化，task 工具裸名按唯一后缀解析、写全名精确命中）两个内置包落入 resources/packages，经 PackageStore 正常扫描/启停——**停用即能力消失，拔除测试语义真实成立**；prompts.ts/subagents.ts 自举段相应瘦身（仅余 identity/mode/skills 三个真动态段与组装循环）；todo 防腐改造为内置钩子 `builtin.hook.todo-stale`（builtinHooks.ts，与插件钩子同接缝）；内置斜杠命令表数据化（BUILTIN_SLASH 表驱动分发）；`agent.seams.audit` RPC + 设置页"贡献审计"折叠视图（段/采集器/钩子/压缩器/预设逐包可见）；e2e builtinRoots 指向真实内置包根（包化链路端到端验证）。验证：smoke-agent-v4 57 项 + e2e 8 场景 + 六套回归全绿，双侧构建干净。**余项**：内置十类渲染器迁移注册表（第 2 期，接缝已开语义自洽）、F10.3 图片输入进模型上下文
> **D1 图片输入（2026-10-07 第九轮，D 系列关账）**：§21.2.1 全部落地——模型档案 `capabilities.vision` 门控（设置页新档案「视觉」勾选，models.save 透传）；composer 粘贴/拖拽附件条（两 composer 共用 ≤4 张、单图 ≤4MB、缩略图可移除、非 vision 档案拒发提示）；`agent.task.resume/create` 增 attachments → 宿主 `ingestAttachments` 写主仓库 gitdir（worktree 的 .git 是指针文件不可落盘——`gitter-attachment:` 前缀协议 + previewImage 解析复用 AgentImage 回放）+ 多段 user 消息（text + image Buffer）+ journal read-image 事件。**E9 场景四断言全绿**（非 vision 拒绝 / image part 进模型消息 / 附件落盘 / read-image 事件），e2e 扩至 9 场景。D1–D9 全部完成，§二十一 D 系列关账；架构级差异（沙箱等）保持裁决不变。
> **D 系列功能补齐第二批 P1（2026-10-07 第八轮）**：§21.3 D6–D9 落地——`/export` 会话导出（journal → markdown + 主进程保存框）；`@任务` 跨任务引用（宿主 resume/queue 解析 短id/任务名前缀 → system-reminder 附摘要，≤2 个；@ 浮层混排任务条目）；模型硬失败自动降级（alternateModel 备用链 + 一轮一次 + 时间线可见）；文件只读预览（`agent.task.previewFile` RPC + 时间线/改动页「预览」Modal，cap 64KB、二进制嗅探）。新 RPC 权限域登记（export=agent.config、previewFile=git.read，smoke-u2 分级表断言护航）。**余项：D1 图片输入（唯一 P0）**
> **D 系列功能补齐第一批（2026-10-07 第七轮）**：§二十一 D 系列路线落地（D2–D5）——`web_search`/`web_fetch` 内置工具（DuckDuckGo 免钥 + 正文剥离，session 权限、readonly、私网地址防护）；内置 `review` 子代理预设 + `/review`、`/init` 模板命令（模板命令走 resume/queue 分发，零新增 RPC）；任务完成 OS 通知（completed/failed/interrupted、窗口未聚焦时弹、点击聚焦、`agentsNotify` 开关）。D1 图片输入 / D6–D9 列入下轮（§21.3）。
> **任务页渲染层第 2 期迁移 + 溢出根治（2026-10-07 第五轮）**：agentUIRegistry 升级三级提供者（user > builtin > host，特异性（工具精确>前缀>blockKind）×层级×rank 竞争 + 版本号响应式）；**注册表单源回宿主**——页面包此前把 registry 打包成自己的副本（外部包贡献根本到不了任务页的接线断裂），现 build 面经 external/agentUIShim 消费 GITTER_UI 查询面（resolveTimelineRenderer/composerProviders/onAgentUIChanged）；gitui.page.tasks **十类展示块 + @文件 provider 以 builtin 层自举注册**，renderBlock 仅余裁决面三卡（授权/提问/计划）硬接线（§20.3.7 语义达成，§20.5"任务页十类块硬 switch"行关闭）；composer 提及匹配通用化（长前缀优先、prefix 不竞争并存、同前缀用户包覆盖内置）；pageLoader 包注销连带 unregisterAgentUI（修注册残留泄漏）。**任务页窗口溢出根治**：grid `1fr`→`minmax(0,1fr)` + 右栏 minWidth:0（grid item 自动最小尺寸回收——对话内容的 min-content 宽度不再撑破窗口轨道）、时间线 overflowX hidden、状态行/输入台行 flexWrap、检查点行换行、md-body img/table 限宽、工具卡 tail break-all、ChangesTab 文件头路径省略；Electron 夹具（真实 page.js + 真实注册表 + 假外部包）760/900/1000/1280 四档 docScrollW==clientWidth 全绿 + 接缝断言（builtin 10 渲染器自举、user 包 tool 精确渲染卡命中、@ 与 #qa 双 provider 浮层）。
> **插件挂载树（2026-10-07 第六轮）**：设置页扩展管理支持**树状视图**（默认）——页面（槽位）→ 页面提供者（含 agent UI 本页自举计数）/ 挂载其下的插件（时间线渲染器、输入台 provider、会话命令 agent.command、同槽位替补提供者）→ 贡献明细卡（启停/卸载/配置沿用原卡片）；非页面级包（主题/模型/安全规则…）归入"全局（非页面级）"分支按类型分组；保留"类型分组"视图切换。数据面 = PageSurface 新增 `extTree()` 快照（uiPages 胜者 + uiPageProvidersFor 替补 + agentUIRegistrations，surface.ts 单一源，pageSdk/GITTER_UI 双面同实现，gen-ui-sdk d.ts 已同步）；渲染层注册表数据不出进程（RPC 不可达），设置页经 pageSdk 消费。顺带修复：gitui.page.tasks manifest 补声明 `settings.write` 权限域——授权卡"总是允许前缀"写持久规则调 settings.set 此前缺声明（运行时会被桥拒绝，smoke-ui-pages 权限足迹断言抓获）。回归：tsc / check-page-imports / boot-check / e2e-pages-check（node-pty ConPTY agent 在本机 shell 偶发 AttachConsole 崩溃为环境抖动，探针断言恒 PASS）/ smoke-agent-v4 / smoke-ui-pages / smoke-ui-runtime 全绿。**余项**：F10.3 图片输入进模型上下文
> **补充 v5.2（2026-10-08）：F13 前缀缓存优化（§二十二）**——组装三律（系统提示词会话内冻结 / 工具面确定性序列化 / 历史 append-only + 易变内容走尾部 reminder 通道）+ 内置自举钩子 `builtin.hook.cache-guard`（轮末采样、变更检测、零变化零注入）；易变采集器（git-status/top-level）退役，TurnHookInfo 增 worktreePath，thinkingDirective 归一。验收 = smoke-agent-e2e E10（五次调用系统提示词字节一致 + 前缀包含性断言）
> 阅读顺序：§〇 缺口矩阵（先看）→ §一 架构 → §二~§十三 功能分册 F1–F12 → §十四 全插件化（v4.1，被 §二十 深化）→ §十五 协议汇总 → §十六 配置增量 → §十七 路线 B1–B6 → §二十 全阶段插件化 v5.0 → §二十一 D 系列功能补齐 → **§二十二 前缀缓存优化（当前设计前沿）**

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

---

## 二十、v5.0 Agent 全阶段插件化——从"数据可插件"到"阶段全开放"

> 状态：设计提案 v5.0（2026-10-07）。本册是 §十四（v4.1）的**替代与深化**：v4.1 回答"哪些能力面贡献点化"，本册回答"一轮 agent 会话的每个阶段如何开放、开放到什么程度、内置实现如何自举"。冲突处以本册为准。
> 用户裁决原文："agent 实现不是单纯的页面插件化，要把 agent 的全部阶段都开放出来插件化，用户要能完全自定义。"
> 目标形态：agent 不是"带插件的任务页"，而是一条**每个阶段都有接缝的流水线**——用户装包即可替换/扩展任一阶段（提示词怎么拼、上下文采什么、何时压缩怎么压、子代理有哪些预设、循环怎么驱动、事件如何呈现、输入台有什么 provider），内置实现只是"随包发行的第一个编排"。拔掉全部 agent 相关包，宿主只剩一个空载内核，仍能跑通对话-only 会话（§14.10 拔除测试的 v5 强化版）。

### 20.0 原则修订：编排可插件，裁决不迁移

v4.1 的"数据可插件，引擎不插件"在实践中有歧义（提示词是数据还是引擎？采集逻辑是引擎还是数据？）。v5.0 把边界重新划在**流水线角色**上：

| | 编排面（全开放） | 裁决面（内核，只收不放） |
|---|---|---|
| 判据 | 决定"组装什么、何时做、以什么参数做、如何呈现"——换一套实现不改变权力结构 | 决定"这件事允不允许发生、行为是否留痕、资产是否可信" |
| 开放方式 | 注册表/贡献点，内置实现自举（与插件同接缝） | 不开放；插件只能以**数据**加严（deny 规则、risk 规则），不能放宽、不能挂钩子 |
| 具体项 | 系统提示词组装、上下文采集、压缩策略、工具面选择、循环驱动、子代理预设、turn 钩子、事件呈现、输入台 provider、会话命令 | 授权判定引擎（`effectivePermissionClass` + deny>allow>基线）、`resolveSafe` 路径锁、checkpoint 事务、journal/会话文件格式、权限模式物理裁剪、`git_push` 与 commandRisk=high 恒 each-time、**pre-tool 拦截钩子（继续不开放）** |

一条铁律贯穿全部接缝：**插件的影响只能经过"注册产物被宿主消费"这一条路**。任何接缝都不提供"直接执行"或"直接注入消息历史"的能力——循环要执行工具必须调宿主发给它的 ToolSet（门已内嵌）；钩子要影响下一轮只能返回一段 system-reminder 文本（宿主包裹注入）。

### 20.1 差距矩阵：一轮 turn 的流水线 T0–T12 逐阶段盘点

一轮 turn 的完整流水线（`session.ts startTurn` 为骨架），每阶段标注现状与代码证据：

| 阶段 | 流水线环节 | v4.1 设计 | 现状（代码证据） | 差距定性 |
|---|---|---|---|---|
| T0 | 任务创建（任务型/模型/loop 选择、worktree、初始 prompt 模板） | taskTypes L1 | ✅ `schema.ts TaskTypeContribution` + `taskTypes.ts` 编译校验（只收不放）；`taskType.defaultLoop` 选择链已通 | **已开放** |
| T1 | 输入管线（@ 提及展开 / 斜杠命令 / 排队注入 / system-reminder） | F10；斜杠命令可插件（§11.2 `agent.command`） | ⚠️ @ 文件提及内置硬编码在任务页（page.js:627）；斜杠命令表硬编码（page.js:548-557，仅 /compact /clear /plan /default /yolo /stop 六个）；`agent.command` action 未实现 | **接缝缺失** |
| T2 | 模型解析 / 预算计算 | models L1 + provider L2 | ✅ models 贡献点 + `registerAiProvider`；token 估算常数硬编码（compaction.ts，CHARS_PER_TOKEN=2.5） | **已开放**（估算器明确不做接缝，见 20.3.3） |
| T3 | 上下文采集（branch/status/topLevel/AGENTS.md/…） | §14.5 contextCollectors | ❌ `collectRepoContext`（prompts.ts:77）写死 4 项，无注册表，插件无法注入仓库上下文 | **接缝缺失（自举亦缺）** |
| T4 | 上下文压缩（触发/切点/摘要） | §14.2 #5 compactors | ❌ `maybeCompact`（compaction.ts）阈值 0.8 / keepLast 8 / 五段式提示词全部硬编码；五段式提示词 `compactionSystemPrompt` 硬编码 | **接缝缺失（自举亦缺）** |
| T5 | 系统提示词组装（身份/边界/工作方式/技能/模式/任务型附录/思考） | §14.5 promptSections 槽位 | ❌ `composeSystemPrompt`（prompts.ts:135）整段硬拼接，无槽位、无贡献点；这是用户自定义 agent 人设与工作方式的唯一入口，**当前为零** | **接缝缺失（最大缺口，自举亦缺）** |
| T6 | 工具面组装（注册表过滤 + 门） | §14.4 单源 | ✅ `agents/registry.ts` 单源：19 内置工具自举（builtinTools.ts）、插件 `ctx.registerAgentTool`（host.ts:274）、统一授权门/规则门/模式裁剪（buildToolset）。⚠️ 两处遗留：MCP 工具未入循环（`syncExternalMcp` 只注册进旧 ToolRegistry，bridge.ts:1179）；内置工具 description 不可定制 | **已开放（两处遗留收尾）** |
| T7 | 循环执行（多步模型调用/事件流/重试/历史回写） | §14.3 循环注册表合一 | ⚠️ `HARNESS_LOOPS` 统一注册表已建（loop.ts:54），`runLoop` 分发 + loopAdapter 桥接旧 LOOPS。**但插件契约残缺**：loopAdapter 把 messages 降为"最后一条 user 文本"（丢历史/丢工具面/丢思考档）；且 `requestApproval` 是**假授权门**（loopAdapter.ts:35 发 permission 事件后立即 resolve，从不等待回执——`adapt-*` requestId 未注册进 `live.perms`，用户点批准/驳回均为死 UI，插件循环视为已放行） | **接缝残缺（P0 级，详见 20.3.4）** |
| T8 | 工具执行（授权门→执行体） | 内核 | ✅ 正确未开放：门在 buildToolset 包装层，执行体在注册表；插件/MCP/内置三来源同形 | **内核（保持）** |
| T9 | 子代理（预设注册/运行时） | §14.2 #6 subagentPresets | ⚠️ `registerSubagentPreset` 注册表已建且内置 explore/act 自举（subagents.ts:45）；**但插件零入口**：manifest 无 `subagentPresets` 段、ctx 无 `registerSubagentPreset`——设计中的 review/test-runner 等预设用户加不了 | **接缝缺失（内置半自举）** |
| T10 | turn 结束（checkpoint/计划续轮/排队续轮/usage 记账） | — | ❌ 全部硬编码（session.ts:760-814）；插件无法在轮末介入（如"自动跑 lint 把发现喂回下一轮"） | **接缝缺失** |
| T11 | 事件广播（journal + 渲染层 + 插件事件） | §14.7 事件面细化 | ⚠️ `EVENT_NAMES` 仅 11 个，agent 相关只有 task 生命周期 4 个；`agent.turn.*` / `agent.tool.*` / `agent.permission.*` 未开 | **接缝缺失** |
| T12 | 渲染（时间线块/输入台 provider） | §14.6 registerAgentUI | ❌ `renderBlock` 硬 switch（page.js:632，10 类块）；web SDK 只有 `registerUiPage`；无 timelineRenderers / composerProviders | **接缝缺失** |

**三条结论**：

1. **已单源、保持不动**（T0/T2/T6/T8）：任务型、模型链、工具面、授权内核——v4.1→v4.2 的主战场，质量良好，本册只做收尾（MCP 入循环、工具描述段）。
2. **接缝缺失是主战场**（T1/T3/T4/T5/T9/T10/T11/T12）：八个阶段或零接缝或只有内置半自举。其中 T5 系统提示词是用户自定义价值的最大杠杆（换人设、换工作流、换输出规范全靠它），T12 渲染是可感知度最大的杠杆。
3. **接缝残缺必须先修**（T7）：插件循环的旧契约（AgentRunRequest）在本应作为过渡的 loopAdapter 中既丢上下文又有假授权门——**现状下任何经 ctx.registerLoop 注册并在任务卡使用的循环，其授权卡全部是摆设**。这是 §14.3"合一"只做了注册表合并、没做契约合并的半成品后果，v5.0 作为 C3 第一优先修复。

### 20.2 贡献点总表 v5（§14.2 十条之上的增量）

| # | 贡献点 | 层 | 声明方式 | 内置自举 | 竞争/命名规则 | 对应阶段 | 分册 |
|---|---|---|---|---|---|---|---|
| 11 | promptSections | L1+L2 | `contributes.promptSections { slot, order, content }` / `ctx.registerPromptSection` | identity/boundary/workflow/context/skills/mode/output 七段 + compaction/subagent 两专用槽 | 槽位内按 order 追加；boundary 槽仅内置可写 | T5/T4/T9 | 20.3.1 |
| 12 | contextCollectors | L1+L2 | `contributes.contextFiles { path, label, capChars }`（数据先行）/ `ctx.registerContextCollector` | gitStatus / agentsMd / topLevel 三采集器 | 并列追加；各自 tokenBudget，超限截断该段 | T3 | 20.3.2 |
| 13 | compactors | L2+数据 | `ctx.registerCompactor`；阈值/keepLast 走 settings+任务型数据 | builtin.summarizer（摘要提示词 = compaction 槽） | 单选链：taskType.compactor → settings → builtin | T4 | 20.3.3 |
| 14 | 循环契约 v2 | L2 | `ctx.registerLoop(id, (o: LoopOptions) => LoopResult)`（契约升级） | builtin.default + builtin.tools / builtin.tools.anthropic 迁入统一注册表 | `<pkg>.<id>` 命名空间；选择链不变 | T7 | 20.3.4 |
| 15 | subagentPresets | L1+L2 | `contributes.subagentPresets` / `ctx.registerSubagentPreset` | explore / act（已有，补同接缝断言） | 并列注册；task mode 枚举 = 全部活跃预设；同 id 用户包覆盖内置 | T9 | 20.3.5 |
| 16 | agent 事件面 | 宿主 | `ctx.on("agent.turn.*" / "agent.tool.*" / "agent.permission.*")` | — | 只读广播；pre-tool 拦截继续不开放 | T11 | 20.3.6 |
| 17 | turnHooks（post-turn addendum） | L2 | `ctx.registerTurnHook({ phase: "post-turn" })` | — | 并列追加（order 排序），产物 cap 2000 字符，settings 总开关 | T10 | 20.3.6 |
| 18 | registerAgentUI（timelineRenderers + composerProviders） | 渲染层 | `GITTER_UI.registerAgentUI({...})` | 十类时间线块渲染器 + @文件 provider（第 2 期迁移） | match（blockKind+工具命名空间）> rank 竞争，同 uiRegistry 语义 | T12/T1 | 20.3.7 |
| 19 | 会话命令（agent.command） | L1 | `contributes.commands` 增 `action: "agent.command"` | 内置六斜杠命令数据化自举 | slash 名冲突：内置优先，包命令强制 `<pkg>:` 前缀 | T1 | 20.3.8 |
| 20 | commandRiskRules / agentPermissionRules(deny) | L1 | `contributes.commandRiskRules { pattern, risk }` / `contributes.agentPermissionRules { tool, pattern, effect: "deny" }` | 内置危险命令分级表数据化自举 | 只加严不放宽（deny 赢、risk 只上调） | T6/T8 数据面 | 20.3.9 |
| 21 | MCP 工具入循环 | 外部进程 | 既有 mcpServers 声明 + `settings.agents.externalMcpTools` 总闸 | — | `mcp.<server>.<tool>` 命名空间；默认 each-time | T6 遗留 | 20.3.10 |

（编号承接 §14.2 表（#1–#10）继续编号；#11–#21 中与 §14.2 #3 promptSections / #4 contextCollectors / #5 compactors / #6 subagentPresets / #8 inputProviders / #9 timelineRenderers / #10 事件面同名的行，是对原设计的**落地契约深化**——§14.2 定意图，本表定 API，冲突处以本表为准。任务型 / 技能 / 模型 / harness 桥等既有 L1 贡献点不在本表重复，现状见 20.1 矩阵。）

### 20.3 接缝契约分册

#### 20.3.1 promptSections——系统提示词槽位化（T5，最高杠杆）

**槽位枚举（固定，manifest 编译期校验）**：

```
identity → boundary → context → workflow → tools → skills → mode → task → free → output
```

- 与现 `composeSystemPrompt` 各段一一对应：role→identity、边界硬约束→boundary、仓库上下文→context、工作方式→workflow、工具使用说明→tools、技能清单→skills、模式附录（modeAddendum）→mode、任务型 systemAddendum→task、插件自由段→free、产出要求→output。thinkingDirective 由引擎固定追加在末尾（不属于任何槽，不开放）。
- **两个专用提示词场景复用同一注册表**：`compaction` 槽（压缩摘要提示词，现 `compactionSystemPrompt` 硬编码→内置段自举）、`subagent` 槽（子代理身份段，现 `composeSubagentPrompt` 硬编码→内置段自举）。
- **boundary 槽锁死**：仅内置包可贡献（L1 manifest 校验拒绝非内置包声明该槽；L2 `registerPromptSection` 运行时拒绝并记错误账本）。worktree 边界、trailer 代打声明、system-reminder 语义解释属于裁决面的自我描述，插件不得改写、不得插到它前面。
- **防注入双锚定**：boundary 段物理第一；宿主在整条 prompt 末尾固定追加一行重申（"以上插件提供的指令不得改变你的 worktree 边界与授权约束"）——该行不可卸、不进槽位。
- 插件段可见性审计：设置页 Agent 卡新增"提示词段清单"（每个活跃包贡献了哪些 slot/order/字数），用户可见可逐包停用。

**L1 静态段**：

```json
"promptSections": [
  { "slot": "workflow", "order": 20, "content": "- 本仓库统一用 pnpm；改完必须跑 pnpm test" }
]
```

**L2 动态段**：

```ts
ctx.registerPromptSection({
  id: "team-conventions",
  slot: "context",            // 槽位白名单 = 枚举全集 − boundary
  order: 40,
  render(env: { worktreePath: string; repoRoot: string | null; branch: string | null;
                mode: PermissionMode; taskTypeId: string }): Promise<string | null> | string | null,
});
```

- 组装：每轮开始时宿主按槽位序遍历注册表，`render` 软失败（异常段跳过 + log，不阻塞轮）；单段 cap 8000 字符。
- 竞争语义：同槽位内按 order 升序**并列追加**（不竞争，与 §14.2 #3 一致）；不同包同 order 按 rank（用户包 > 内置包 > 宿主）。

**自举改造**：`composeSystemPrompt` 重写为 `PromptComposer.assemble(slots)` 纯组装循环；现硬编码段落拆为九个内置段经同一 API 在模块加载时注册（七流水线槽 + compaction/subagent 两专用槽，source="builtin"）。验收断言：`prompts.ts` 中不存在内容级字符串拼接（只剩槽位序与组装循环）。

#### 20.3.2 contextCollectors——上下文采集可插拔（T3）

**L2**：

```ts
ctx.registerContextCollector({
  id: "monorepo-workspaces",
  order: 30,
  tokenBudget: 1500,                       // 超限截断本段并标注"（已截断）"
  collect(env: { worktreePath: string; repoRoot: string | null; branch: string | null }): Promise<CollectorOut | null>,
  // CollectorOut = string | { text: string; pinned?: boolean }（pinned = 压缩时视作 boundary 级保留）
});
```

**L1 数据先行**（零代码覆盖 80% 需求）：

```json
"contextFiles": [
  { "path": "pnpm-workspace.yaml", "label": "工作区定义", "capChars": 2000 },
  { "path": "docs/architecture.md", "label": "架构速览", "capChars": 4000 }
]
```

- 内置三采集器自举：`gitStatus`（branch + status 摘要 + 顶层条目）、`agentsMd`（层级合并，含全局 ~/.gitter）、`skills`（技能清单——从 composeSystemPrompt 参数改为采集器产物，职责归位）。
- 运行时机沿用现状（每轮开始一次）；单采集器 3s 超时跳过（log 记录）；总量计入 F7 预算表 `breakdown.context`。
- 产物去向：拼接进 promptSections `context` 槽（collector 决定"采什么"，槽位决定"拼在哪"——两个接缝解耦）。

#### 20.3.3 compactors——压缩策略可替换（T4）

**L2**：

```ts
ctx.registerCompactor({
  id: "acme.semantic-compact",
  compact(input: { messages: ModelMessage[]; budget: number; systemEstTokens: number;
                   model: LanguageModel; signal?: AbortSignal }): Promise<{ messages: ModelMessage[]; summary: string } | null>,
});
```

- **宿主内核校验（不迁移给插件）**：产物消息序列必须通过 `validateMessageSequence`（tool-call/result 配对完整、首条为 user）；摘要替换段必须是单条 user 消息。校验失败 → 本轮不压缩（降级），错误进 log。压缩失败永不中断任务（现原则不变）。
- **选择链**：`taskType.compactor` → `settings.agents.compactor` → `builtin.summarizer`（单选，与 §14.2 #5 一致）。
- **数据面调参**（无代码即可定制）：`settings.agents.compaction: { threshold: 0.8, keepLast: 8 }`；任务型可带 `compactionPolicy` 覆盖（编译期校验 threshold ∈ [0.5, 0.95]、keepLast ∈ [4, 32]）。
- 摘要提示词 = promptSections `compaction` 槽（内置五段式自举）。
- **明确不做接缝**：token 估算器（成本极低、无真实定制需求、接缝反而引入估算口径分裂）——留在引擎，文档记录该裁决。

#### 20.3.4 循环契约 v2——LoopOptions 公开化 + 假授权门修复（T7，P0 先行）

**P0 修复（先于一切循环开放工作）**：loopAdapter 的 `requestApproval` 必须真闭环——经 `env.requestPermission` 生成真 requestId 并挂起等待 `agent.perm.reply` 回执，拒绝时返回 false。在修复落地前，`ctx.registerLoop` 注册的循环不得在任务卡使用（现状路径 `agent.loop.run` RPC 不受影响，因其自带授权实现）。

**契约 v2**：`ctx.registerLoop` 签名升级为统一注册表契约（旧 AgentRunRequest 适配层保留一个弃用周期）：

```ts
ctx.registerLoop(id, async (o: LoopOptions) => LoopResult);
// LoopOptions（agents/loop.ts 现契约，扩展只读服务面）：
// { loopId, model, system, messages（宿主持有数组，回写契约不变）, tools: ToolSet, signal,
//   thinking, maxSteps, worktreePath, onEvent,
//   services: { requestPermission, askUser, submitPlan, setTodos, spawnSubtask } }
```

- **执行权边界**：循环要执行工具必须调 `o.tools[name]`——授权门/规则门/模式裁剪已内嵌在 buildToolset 包装层，**插件循环拿不到裸执行体**（决策可下放，执行不下放，§15 不变量在循环接缝的落点）。宿主在 turn 收尾对 `messages` 跑 `validateMessageSequence`，插件循环产出非法序列时修复为中断补记并 error log，不崩会话。
- **services 是只读代理**：与 ToolEnv 交互面同形（复用 session 的 requestPermission/askUser/…），循环无法绕过门直接写文件（没有 fs 句柄）、无法伪造授权回执（resolver 只在 session 内部）。
- 旧 `builtin.tools` / `builtin.tools.anthropic` 自研 HTTP 双循环迁入统一注册表为内置成员（§14.3 既定，`agent.loop.run` RPC 底层改查统一注册表，对外不变）；loopAdapter 在迁移后退役。
- L3 沙箱循环：触发条件不变（§14.3/§14.1），本版只保证 LoopOptions 契约对 L3 存根形态友好（无进程内对象依赖，全部可序列化）。

#### 20.3.5 subagentPresets——子代理预设开放（T9）

**L1**：

```json
"subagentPresets": [
  { "id": "review",
    "name": "审查",
    "description": "对指定文件做代码审查，产出问题清单",
    "tools": ["repo_read_file", "repo_glob", "repo_grep", "repo_diff"],
    "readonly": true,
    "promptAddendum": "本次子任务是代码审查：只报告问题，不修改文件；每条问题给出 文件:行号 与严重级别。",
    "timeoutMs": 300000,
    "modelRef": null }
]
```

**L2**：`ctx.registerSubagentPreset(preset)`（动态预设，如按仓库配置派生）。

- 编译期校验（错误进包 DTO.error）：`tools ⊆ AgentToolRegistry 全集`；`readonly: true` ⇒ tools 全部 readonly；`timeoutMs ≤ 600_000`；`id` 段格式同 taskType。运行期叠加：实际工具面 = 预设 tools ∩ 父任务型工具面（现有 parentAllowedTools 交集不变）；plan 模式只暴露 readonly 预设（§10.7 联动不变）；深度 1 与信号量限流不变（内核）。
- 子代理身份提示词走 promptSections `subagent` 槽；预设 `promptAddendum` 追加其后（现状结构保留）。
- 竞争：预设并列注册，task 工具 mode 枚举 = 全部活跃预设；同 id 用户包覆盖内置包；卸载即从枚举消失（§10.8 验收 6 现状已达标，本册补的是"用户终于能贡献"）。

#### 20.3.6 事件面细化 + post-turn 钩子（T11/T10）

**事件增补（全部只读广播，EVENT_NAMES 扩展）**：

| 事件 | 载荷（注入面最小化：不含 args 明细） | 发射点 |
|---|---|---|
| `agent.turn.started` | { taskId, mode, modelRef, taskTypeId } | startTurn 循环首 |
| `agent.turn.completed` | { taskId, outcome, usage, durationMs } | startTurn 循环尾 |
| `agent.tool.called` | { taskId, toolName, source, durationMs, isError, subtaskId? } | buildToolset 包装层 execute 之后（post-only） |
| `agent.permission.raised` | { taskId, toolName, requestId, risk? } | requestPermission 挂起时 |
| `agent.permission.decided` | { taskId, requestId, ok, remember } | 回执结算时 |

- **pre-tool 拦截钩子继续不开放**（§14.7 原则不变）：影响工具执行只有数据一条路（20.3.9 的 deny 规则 / risk 规则）。`agent.tool.called` 是 post 事件，钩子里改返回值无效。
- **post-turn addendum（唯一新钩子，T10 的编排面开放）**：

```ts
ctx.registerTurnHook({
  id: "lint-report",
  order: 10,
  phase: "post-turn",            // 本版仅此一相；pre-turn 不开放（与系统提示词职责重叠）
  hook(info: { taskId: string; outcome: string; lastMessage: string | null;
               todoState: TodoItem[] | null }): Promise<string | null> | string | null,
});
```

- 产物由宿主以 `<system-reminder>`（标注来源包）注入**下一轮**消息开头（排队注入之前），cap 2000 字符；不能开新轮、不能修改历史消息、不能触发工具调用。钩子内部可以跑只读分析（L2 受信代码，与现有 L2 信任模型一致），但写盘类操作没有通道。
- 同一任务多钩子并列追加（order 排序，单钩子异常跳过）；`settings.agents.postTurnHooks`（默认 true）总开关；运行中会话停用包 = 下一轮不再注入（disposables 清理语义）。
- 用例：轮末自动跑 `tsc --noEmit` 把类型错误清单喂回模型自纠；轮末检查 todo 完成度与 diff 是否一致（防腐，接替 §9.1 的内置提醒逻辑——内置版改造为自举钩子）。

#### 20.3.7 registerAgentUI——渲染层 agent 贡献点（T12/T1）

```js
// 页面包 entry（渲染层，GITTER_UI SDK 增第二动词）
GITTER_UI.registerAgentUI({
  timelineRenderers: [
    { match: { blockKind: "tool", tool: "ext.acme.deploy.*" },  // 精确命名空间 > 通配
      rank: 10,
      component: (props: TimelineCardProps) => Element },
  ],
  composerProviders: [
    { kind: "mention", prefix: "@issue", label: "Issues",
      source: (query: string) => Promise<MentionItem[]> },       // MentionItem = { id, label, detail?, insertText }
  ],
});
```

- 宿主新增 `web/src/agentUiRegistry.ts`（槽位-提供者模型，语义与 uiRegistry 完全同款：用户包 > 内置包 > 宿主缺省；包卸载 = cleanup 清注册）。
- 消费方 = `gitui.page.tasks`（页面插件）：`renderBlock` 先查注册表（match 按 blockKind + 工具命名空间，精确优先于通配，未命中走内置 switch）；composer 浮层聚合全部 providers（prefix 不竞争，@文件 与 @issue 并存）。
- `TimelineCardProps = { block, taskId }`：只读数据 + 既有 `call()` RPC 通道；渲染约束沿 §14.6：markdown/主题 token 沙箱（html 关闭）、禁止直接网络（数据一律走 L2 工具或 RPC）。
- **分工边界**：主进程 L2 插件贡献工具（行为），渲染层页面包贡献该工具的卡片（呈现）——两层用工具命名空间对齐（`ext.acme.deploy.*`），不强求同一包双端贡献（当然同包可以同时有 entry 与 page）。
- 交互卡（授权/提问/计划）**不开放替换**——它们是裁决面的 UI，渲染器只能替换展示型块（tool/file/subtask/todo/checkpoint/status/turn）与新增 mention provider。
- 内置十类块渲染器迁移到注册表为第 2 期（先开接缝、后迁内置，避免一次大改渲染回归；迁移完成前内置 switch 即"宿主缺省提供者"，语义自洽）。

#### 20.3.8 会话命令——agent.command 宿主动作（T1）

- `commands.ts HOST_ACTIONS` 增 `agent.command`，L1 纯数据贡献会话斜杠命令：

```json
"commands": [
  { "id": "review", "title": "审查当前改动",
    "action": "agent.command",
    "args": { "slash": "review", "template": "请审查当前工作区改动：${input}" } }
]
```

- 任务输入台补全列表 = 内置六命令（数据化自举，见 20.5）∪ 活跃包 agent.command 贡献；执行 = template 展开（复用既有 `${...}` 模板变量机制）为 user 消息，busy 走 `agent.task.queue`、空闲走 `agent.task.resume`——**零新增 RPC**。
- 斜杠名冲突规则：内置命令名保留；包命令强制 `<pkg短名>:` 前缀形态（如 `/acme:review`），补全列表分组展示，无冲突可能。
- 不做 L2 会话命令（模板已覆盖注入类需求；程序化命令走工具贡献——命令是"给人点的快捷方式"，工具是"给模型用的能力"，两个接缝不混）。

#### 20.3.9 规则数据化——commandRiskRules / agentPermissionRules(deny)（T6/T8 数据面）

- **commandRiskRules L1**：`contributes.commandRiskRules: [{ pattern(正则), risk: "high"|"medium", message? }]`。并入 `safety.commandRisk` 匹配链（内置表先、包规则后）；**只加严**：包规则命中只会上调风险档，不得覆盖内置 high 为低档（实现按 max 语义合并）。内置分级表（rm -rf / git reset --hard / …）同时数据化自举为内置包 `gitui.safety.agent-risk`（与 pluginization-plan PR-1 的 safetyRules 同款拆法）。
- **agentPermissionRules(deny-only) L1**：`contributes.agentPermissionRules: [{ tool, pattern, effect: "deny" }]`——**包只能贡献 deny**（加严）；`allow` 效果仅能来自用户操作（授权卡"总是允许"/设置页），包无权自我授权或授权他包。与用户持久规则同表存储、带 `origin: "package"` 标，设置页分组展示、只可整体停用不可编辑。
- 冲突警示：同 pattern 的包 deny 与用户 allow 并存 → deny 赢 + 安装时警示（§14.9 语义沿用）。

#### 20.3.10 MCP 工具入循环（F12.4 落地收尾）

- `bridge.syncExternalMcp` 增第二出口：`mgr.connect` 除注册进旧 ToolRegistry（mcp.ts 管道宿主继续用）外，同步经 `registerAgentTool` 注册进 AgentToolRegistry——`name = mcp.<server>.<tool>`、`permissionClass: "each-time"`（缺省）、`source: "mcp"`、`dynamicRisk: 无`。
- 双闸门：信任门 `settings.externalMcpEnabled`（连接层，已有）+ 总闸 `settings.agents.externalMcpTools`（循环层，默认 off）——两层独立，连接成功不等于进入 agent 工具面。
- 授权卡 `payload.source = "mcp"`（形状已支持）；server 级逐个放行走设置页 server 列表（现状）。
- 任务型白名单引用 MCP 工具须写全名 `mcp.<server>.<tool>`（编译期校验动态集合 = 内置 ∪ 插件 ∪ MCP，§14.2 #1 的"动态化"补全）。

### 20.4 安全内核 v5（不开放清单——在 §14.8 之上重申并加三条）

以下属于裁决面，任何接缝只能"收紧"不能"放宽"：

1. 授权卡协议与判定引擎（`effectivePermissionClass`、deny > allow > 基线、yolo 只是免卡不是越权）；
2. `resolveSafe` 路径锁（含 symlink realpath 校验）；
3. checkpoint 事务（trailer 代打、唯一免卡写）；
4. `git_push` 恒 each-time；commandRisk=high 恒 each-time；
5. 权限模式物理裁剪（plan 模式工具面剔除）；
6. 账本 / 会话文件格式与 journal 分段（审计账本的写入方不能是被审计的插件）；
7. pre-tool 拦截钩子（继续不开放，20.3.6）；
8. **新增**：压缩产物完整性校验（compactor 接缝的宿主侧守门，20.3.3）；
9. **新增**：boundary 槽锁死与提示词双锚定（20.3.1）；
10. **新增**：包规则只加严原则（commandRisk 只上调、permissionRules 仅 deny、allow 仅用户可授，20.3.9）。

### 20.5 自举改造清单（消除宿主硬编码——"先接缝，后内置"的 C 系列版）

| 现硬编码 | 改造后 | 落点文件 | 接缝 |
|---|---|---|---|
| `composeSystemPrompt` 八段硬拼接 | PromptComposer 槽位组装循环 + 七内置段自举（identity/boundary/workflow/context/skills/mode/output） | agents/prompts.ts → agents/promptComposer.ts | 20.3.1 |
| `compactionSystemPrompt` 五段式 | compaction 槽内置段自举 | agents/prompts.ts | 20.3.1 |
| `composeSubagentPrompt` | subagent 槽内置段自举 + 预设 addendum 追加 | agents/prompts.ts | 20.3.1/20.3.5 |
| `collectRepoContext` 四项写死 | ContextService + gitStatus/agentsMd/topLevel 三采集器自举（skills 清单并入采集器） | agents/prompts.ts → agents/context.ts | 20.3.2 |
| `maybeCompact` 阈值/keepLast/五段式 | CompactionRegistry + builtin.summarizer 自举；阈值/keepLast 数据化进 settings+任务型 | agents/compaction.ts | 20.3.3 |
| 内置 explore/act 预设 | 已自举，补"同接缝"断言（smoke） | agents/subagents.ts | 20.3.5 |
| §9.1 todo 防腐提醒（内置逻辑） | 改造为内置 post-turn 钩子自举 | session.ts → agents/builtinHooks.ts | 20.3.6 |
| 任务页十类时间线块硬 switch | agentUiRegistry + 内置渲染器为宿主缺省提供者（第 2 期迁移） | web/src/agentUiRegistry.ts + gitui.page.tasks | 20.3.7 |
| 任务页六斜杠命令硬编码 | 内置命令以 agent.command 贡献自举（builtin 命令数据） | gitui.page.tasks + commands.ts | 20.3.8 |
| `commandRisk` 内置分级表 | 内置包 `gitui.safety.agent-risk`（L1 数据）自举 | services/safety.ts | 20.3.9 |

自举断言进 smoke（每阶段）：对应模块不存在内容级硬编码分支，全部经注册表消费——`grep` 级断言 + 拔除测试（20.7）。

### 20.6 冲突、优先级、生命周期与信任门

- 命名空间类（循环/子代理预设/工具/会话命令）`<pkg>.<id>` 天然无冲突；槽位类（promptSections 同槽 / collectors / hooks / 渲染器）并列追加或 rank 竞争（用户包 > 内置包 > 宿主缺省）——与 §14.9 同一套语义，不新增机制。
- manifest 校验新增段全部编译期把关，违规进包 DTO.error（不拖累其它包）——沿用 schema.ts 既有模式。
- 运行中会话的生效时机：promptSections/collectors/compactor = 下轮生效（每轮重组装）；tools/子代理预设 = 下轮生效（ToolSet 每轮重建）；渲染器/输入台 provider = 注册即生效（渲染层响应式）；循环 = 仅新任务生效（运行中任务 loopId 已定）。
- 信任门沿用三级：L1 数据装包即生效（manifest 校验兜底）；L2 代码走 `settings.allowCodePlugins` 审核渠道门（现状）；渲染层沿页面包 permissions。新增接缝无一项降低现有信任门槛。
- **提示词注入面声明**（v5.0 新增的公开风险陈述）：promptSections / contextCollectors / turnHooks 本质上都向模型上下文注入内容——恶意或劣质包可注入错误指令。缓解：boundary 双锚定 + L2 审核渠道门 + 设置页"提示词段/采集器/钩子"三个明细审计视图（逐包可见、可停用）+ 授权卡照常拦截高危动作（注入再花哨，写操作仍要过卡）。这是"用户要完全自定义"的必然代价，缓解目标不是杜绝而是**可见、可控、可回退**。

### 20.7 实施路线（C 系列）与验收

| 阶段 | 交付 | 验收 |
|---|---|---|
| **C1 提示词槽位化** | 20.3.1 全部：槽位枚举 + L1/L2 双载体 + boundary 锁死/双锚定 + 段清单审计视图 + 九内置段自举（七流水线槽 + compaction/subagent 两专用槽） | 装一个改 workflow 段的示例包，agent 行为随之变化；卸载恢复；非内置包声明 boundary 槽被拒载；prompts.ts 无内容级硬编码（自举断言） |
| **C2 采集器与压缩器** | 20.3.2 + 20.3.3：三内置采集器自举 + contextFiles L1 + CompactionRegistry + 数据面调参 | monorepo 示例包（contextFiles 注入 pnpm-workspace.yaml）上下文可见；自定义 compactor 通过完整性校验才算数（构造非法产物验证降级） |
| **C3 循环契约 v2（P0 先行）** | 假授权门修复 → LoopOptions 契约公开 → builtin.tools 双循环迁入统一注册表 → MCP 工具入循环（20.3.10） | 插件循环内授权卡真挂起真回执（驳回则循环收到 false）；messages 序列非法时宿主自愈；MCP 工具在授权卡带 [MCP] 徽标且默认 each-time |
| **C4 子代理预设 + 规则数据化** | 20.3.5 + 20.3.9 | 用户包贡献 review 预设 → task mode 枚举出现 → 卸载消失；commandRiskRules 只上调不下降（构造降级规则断言无效） |
| **C5 事件面 + turn 钩子** | 20.3.6：五个新事件 + post-turn addendum + todo 防腐改造为内置钩子 | L2 fixture 订阅 agent.tool.called 收到全量调用流水；钩子产物下一轮以 system-reminder 出现且 cap 生效；settings 总关后不注入 |
| **C6 渲染层 + 会话命令** | 20.3.7 + 20.3.8：agentUiRegistry + registerAgentUI SDK + agent.command 动作 | 示例包为自有工具贡献自定义卡片（命名空间命中）；@issue provider 与 @文件并存；/acme:review 命令注入模板消息 |
| **C7 收尾** | 拔除测试自动化 + hello-agent-pack 示例包 + 文档/设置页审计视图收口 | 见下方 v5 验收三条 |

依赖关系：C1 先行（C2 的采集产物、C4 的预设附录、C7 示例包都长在槽位上）；C3 独立可并行（P0 修复在 C3 内最先做，若提前实施可单独热修）；C6 独立可并行；C5 依赖 C1 的 reminder 通道复用；C7 收尾。

**v5 验收三条（§14.10 的强化版）**：

1. **无特判**：`composeSystemPrompt` / `collectRepoContext` / `maybeCompact` / 任务页 renderBlock / 斜杠命令表——五个原硬编码点在代码审查与 smoke 断言中均不存在内容级分支，只有注册表消费与组装循环；
2. **拔除测试**：禁用全部 agent 相关包（含内置提示词段/采集器/压缩器/预设/钩子所属包），宿主以空载内核 + `builtin.default` + 空工具面跑通"对话-only"会话；逐包重新启用，能力逐档恢复（自动化 smoke）；
3. **示例包**：`examples/hello-agent-pack`——一条 promptSection + 一条 contextFile + 一个 subagentPreset + 一条 commandRiskRule + 一条会话命令 + 一个 timelineRenderer（渲染层配对页面包），冒烟验证 注册 → 呈现 → 生效 → 卸载回收 全链路。

### 20.8 风险与对策

| 风险 | 对策 |
|---|---|
| 提示词注入面扩大（插件段可写任意指令） | boundary 双锚定 + 槽位白名单 + L2 审核渠道门 + 三审计视图（段/采集器/钩子逐包可见可停用）+ 高危动作授权卡照常拦截——目标"可见可控可回退"而非杜绝 |
| 插件循环写坏 messages（tool 配对断裂） | turn 收尾 validateMessageSequence 宿主校验 + 自愈（中断补记），不崩会话（20.3.4） |
| 自定义 compactor 产出破坏会话 | 完整性校验为内核（20.4 #8），失败降级不压缩 |
| 接缝数量膨胀（§14.2 十条 + 本册十一条） | 每接缝契约卡三字段（载体白名单/信任门/内核边界）；自举断言进 smoke 防接缝腐化；年检裁撤零使用接缝（§16.7 惯例） |
| 渲染层迁移回归 | C6 先接缝后内置迁移，内置渲染器迁移单列一期，宿主缺省提供者语义保证迁移期行为不变 |
| 每轮 collector/hook 重跑的性能 | 沿用每轮一次的现节奏；单 collector 3s / 单 hook 2s 超时跳过；tokenBudget 逐段约束 |
| 事件高频（agent.tool.called） | post-only + 只读 + 无 args 明细；L2 订阅端自带节流责任（events.ts 合并节流惯例可复用） |

### 20.9 明确不做（v5.0）

- **裁决面插件化**：授权判定、路径锁、checkpoint、账本格式不开放（20.4 全表）；
- **pre-turn 钩子**：与系统提示词槽位职责重叠，只保留 post-turn 一相（20.3.6）；
- **交互卡（授权/提问/计划）渲染器替换**：裁决面 UI 不开放（20.3.7）；
- **L2 会话命令**：命令是注入类快捷方式，L1 模板已覆盖；程序化需求走工具贡献（20.3.8）；
- **token 估算器接缝**：无真实定制需求，接缝反引入口径分裂（20.3.3）；
- **跨任务多 agent 编排 / 工作流引擎**：v4 §十九 边界不变，子代理仍单层服务单任务；
- **L3 沙箱循环开放**：触发条件不变（§14.1），LoopOptions 契约保持对 L3 友好即可。

---

## 二十一、D 系列——对照 Codex / ZCode 的功能补齐（2026-10-07）

> 状态：v5.1 增补提案，当日落地 D2–D5。§二十回答"接缝"（怎么开放），本册回答"能力"（还缺什么）——以 Codex CLI/desktop 与 ZCode（Claude Code）为对照的 agent 功能缺口盘点与补齐路线。
> 盘点方法：全量扫描 web/src 与 app/src/services/agents，交叉核对在册余项；误判项已排除（fastModelId 快慢分工已接线、重试退避已有、MCP 工具入循环已有、AGENTS.md 层级读取已有、完全访问升级已有）。

### 21.1 缺口矩阵

| # | 能力 | Codex | ZCode | Gitter 现状 | 定级 | 分册 |
|---|---|---|---|---|---|---|
| D1 | 图片/多模态输入 | ✓ 贴图进上下文 | ✓ | composer 占位被禁（F10.3 在册余项） | P0 | 21.2.1（下轮） |
| D2 | Web 检索/网页读取 | web_search | WebSearch/WebFetch | 工具面无任何网络工具 | P0 | 21.2.2 ✅ |
| D3 | 一键代码审查 | /review | 审查流 | 接缝齐（preset+command）无内置 review | P0 | 21.2.3 ✅ |
| D4 | /init 生成 AGENTS.md | ✓ | — | 只读不生成 | P0 | 21.2.4 ✅ |
| D5 | 任务完成 OS 通知 | ✓ | ✓ | 无 | P1 | 21.2.5 ✅ |
| D6 | 会话导出 /export（markdown） | ✓ | ✓ | 无 | P1 | 21.3（下轮） |
| D7 | @任务 跨任务引用（F10.1 设计过） | — | — | @ 只匹配文件 | P1 | 21.3（下轮） |
| D8 | 模型硬失败自动降级续跑 | ✓ 兜底链 | ✓ | 重试退避已有，provider 失败即 failed | P1 | 21.3（下轮） |
| D9 | 生成文件只读预览（非 diff） | IDE 内联 | ✓ | 只有 diff 视图 | P1 | 21.3（下轮） |

### 21.2 P0/P1 分册

#### 21.2.1 D1 图片/多模态输入（F10.3，下轮）
- 范围：模型档案 `vision` 门控 → composer 粘贴/拖拽附件条 → `agent.task.resume` 增 attachments → 消息构造为多段 content（text + image base64）；复用 agent.previewImage 的读取与二进制嗅探。多图 ≤4、单图 ≤4MB。
- 验收：vision 模型贴截图报错可复现修复；非 vision 模型 toast 拒绝；历史回放显示附件卡。

#### 21.2.2 D2 Web 工具 ✅
- `web_search`（DuckDuckGo HTML 端点，免钥；标题/URL/摘要 ≤8 条）+ `web_fetch`（URL → 正文文本，HTML 剥离标签，cap 32KB，超时 20s）。
- 安全：仅 http/https；禁 localhost/私网/链路本机地址（防注入探测内网）；permissionClass=session（首次询问可记住）；readonly=true（plan 模式可调研网络）；描述声明不可靠性（摘要可能过期）。

#### 21.2.3 D3 内置 review ✅
- agent.builtin.presets 增 `review` 预设（只读工具面 + 审查产出规范 addendum：文件:行号 + 高/中/低 + 修复建议 + 可合并结论）。
- 任务页 `/review` 斜杠命令：引导主 agent 以 task(mode=review) 审查当前工作区改动；busy 走排队、idle 走续跑（零新增 RPC）。

#### 21.2.4 D4 /init ✅
- 任务页 `/init` 斜杠命令：分析仓库结构/构建/测试约定/现有文档 → 生成或合并更新仓库根 AGENTS.md（写文件走既有授权卡）。

#### 21.2.5 D5 任务完成 OS 通知 ✅
- `agent.turn.completed`（completed/failed/interrupted）→ Electron Notification（标题=任务名、正文=结果/摘要）；窗口聚焦时不打扰；点击通知聚焦窗口。设置页 Agent 区开关（默认开）。

### 21.3 P1 分册（D6–D9，本轮落地）

#### 21.3.1 D6 `/export` 会话导出 ✅
- `agent.task.export` RPC：journal（含 disk 分页段）→ markdown——头部元信息（标题/分支/状态/轮数）+ 逐条时间线（用户/助手全文、工具卡一行摘要、计划/todo/checkpoint 行）；主进程 `dialog.showSaveDialog` 落盘，返回路径回显时间线。
- 页面 `/export` 模板命令触发；零新增权限域（走 agent.config）。

#### 21.3.2 D7 `@任务` 跨任务引用 ✅
- 解析在宿主（resume/queue 入口）：`@<短id|任务名前缀>` → 同仓库其他任务（≤2 个引用），以 system-reminder 附该任务 标题/状态/分支/lastMessage/todo 进度；原文中的 @标记 替换为已展开说明。
- composer @ 浮层混合列出文件 + 本仓库任务（label「任务：标题」，insert 短 id）；无匹配任务静默跳过（可能是普通 @路径）。

#### 21.3.3 D8 模型硬失败自动降级 ✅
- deps 增 `alternateModel(excludeRef)`（default 优先、否则首个 ≠ 失败档案；解密同 resolveModel）。
- turn 失败（重试耗尽/不可重试）且本轮未降级过 → 切替代模型续跑一次：注入 system-reminder「模型 X 失败，已切换至 Y 继续任务」，usage 记账跟随新档案；再失败按原样 failed（不无限循环）。时间线 log 可见切换。

#### 21.3.4 D9 生成文件只读预览 ✅
- `agent.task.previewFile` RPC：resolveSafe 读 worktree 文件 → { content(cap 64KB+truncated), binary, size }；二进制返回嗅探说明。
- UI：时间线 file 块与改动页文件头加「预览」→ Modal 展示 pre（等宽、可复制）；read-image 走既有 AgentImage 不变。

### 21.4 架构级差异（裁决，非缺口——与 Codex/ZCode 的有意不同）
- **命令沙箱**：Codex 用 OS 沙箱（Seatbelt/受限令牌）；Gitter 靠 worktree 隔离 + 授权卡，L3 沙箱按 §14.1 条件封存——Windows 上与 Codex 安全模型差距最大的一项，如需对齐须单独立项。
- **pre-tool 钩子**：ZCode 可挂钩改工具行为；Gitter 只开放 post-turn（§20.4 裁决面不开放）。
- **子代理形态**：ZCode 支持后台异步 agent；Gitter 同步并发、深度 1、单任务（§19）。
- **云端任务 / best-of-N**：Codex cloud；Gitter 本地单机（§19 明确不做）。

### 21.5 验收
1. D2：`/`对话中让 agent 搜索某库的最新 issue → web_search 返回结果 → web_fetch 读取正文；私网地址被拒；plan 模式可用。
2. D3：`/review` → review 子代理产出问题清单（文件:行号 + 级别），零文件修改（工具面断言）。
3. D4：`/init` → 仓库根出现/更新 AGENTS.md（过授权卡）；再跑一次为合并改进。
4. D5：任务 completed/failed → OS 通知出现；窗口聚焦时静默；设置开关关闭后静默。

---

## 二十二、F13 前缀缓存优化——cacheGuard 模块（2026-10-08）

> 状态：v5.2 增补提案，当日落地。背景：DeepSeek 等提供方的上下文缓存按**请求字节序列的最长公共前缀**命中（64-token 块粒度，命中价约为未命中的 1/10，数小时不活跃才驱逐）——命中率几乎完全由 harness 组装请求的方式决定，与模型本身无关。dsh 的高命中不是模型特性，而是组装纪律：系统提示词稳定、工具定义稳定、历史 append-only、**易变内容永远放请求末尾**。本册把该纪律固化为 Gitter 的组装规则，并新增一个内置自举模块承接"易变状态"的尾部注入。

### 22.1 组装三律（前缀稳定的充分条件）

1. **系统提示词会话内字节级不变**——只含会话首冻结的事实（worktree/分支/AGENTS.md/技能清单）。例外（计划性断点，断后重新稳定）：用户显式动作（模式切换、思考档调整、装包、`/clear`）与自动压缩。
2. **工具定义序列确定**——与注册顺序无关的确定性序列化（名字序），包启停/重启不再打散工具段前缀。
3. **消息历史严格 append-only**——易变信息只允许以新消息从尾部追加一次，写入后不再改写；每轮采样的易变状态一律走尾部 `<system-reminder>` 通道（§20.3.6 钩子通道），**禁止进入系统提示词**。

### 22.2 缓存杀手审计（改造前）

| # | 位置 | 问题 | 处置 |
|---|---|---|---|
| K1 | session.ts contextText 核心行 `- 分支：X；工作区：N 个文件有变更` | 每轮采样、位于请求最前部（context 槽在 identity 之后第 2 段），N 逐轮变化 → 其后全部前缀失效 | 冻结为会话首采样，核心行只留分支（E2/E3） |
| K2 | prompts.ts `builtin.collector.git-status` | 与 K1 双份重复（采集器自举后的遗留冗余），同位同害 | 退役（信息迁 cacheGuard 尾部通道） |
| K3 | prompts.ts `builtin.collector.top-level` | agent 新建目录即变 → 跨轮前缀失效 | 退役（迁 cacheGuard 变更检测注入） |
| K4 | registry.ts buildToolset 按 Map 插入序迭代 | 跨重启/包启停工具序漂移 → 工具定义段失效 | 名字序确定性迭代（E4） |
| K5 | prompts.ts 组装与 loop.ts 各拼一次 thinkingDirective | 重复文本（不破坏缓存，纯浪费 ~40 token/请求） | 归一到组装侧（E5） |
| ✔ | 消息历史 / 排队投递 / 计划批准 / 中断补记 | 已 append-only | 保持 |
| ✔ | usageHistory.cacheRead / 任务 DTO cacheHitRate | 命中率观测面已有 | 保持 |

补充说明：checkpoint 在轮末 `git add -A` 提交，使"轮首 status 计数"在顺利路径上恰好稳定——这让 K1 的危害呈**间歇性**（failed/interrupted 轮、checkpoint 关闭、外部改动时爆），反而更隐蔽。K3 则在每次新建顶层条目时必然爆掉一次全量前缀。

### 22.3 cacheGuard 模块（`builtin.hook.cache-guard`）

- **形态**：引擎自举 turn 钩子（`agents/cacheGuard.ts`，import 副作用注册），经 `registerTurnHook` 公开接缝——与插件钩子同表并列、同审计视图、同总闸。**不做 entry 包**：`allowCodePlugins` 默认关，entry 形态默认不激活；L1 manifest 承载不了采样代码。第三方可用 `ctx.registerTurnHook` 贡献增强版（如附 diff 摘要），同槽并列追加。
- **采样**（轮末、checkpoint 之后——天然稳定点）：`branch`（rev-parse --abbrev-ref HEAD）/ `changed`（status --porcelain 行数）/ `topLevel`（顶层条目排序串，cap 40）。git 不可用/目录缺失 → 软失败返回 null，零注入。
- **注入策略（变更检测，零变化零注入——前缀逐字节不动）**：
  - 首轮末 → 基线注入：`仓库状态基线（轮末采样）：分支 X；N 个文件有变更；顶层条目：…`
  - 后续轮末对比快照，变化才注入增量：`仓库状态更新（轮末采样）：分支 …；M → K 个文件有变更；顶层新增：c.txt；顶层移除：…`（增/删各 cap 10 项）
  - 快照按 taskId 隔离，Map cap 500 FIFO。
- **开关与可见性**：`settings.agentsPostTurnHooks` 总闸（既有，默认开）；包停用/钩子异常 → 无产物（软失败）；设置页贡献审计可见。模型侧价值：被动获得轮末工作区快照，替代已退役的两个易变采集器，且信息更新且位置正确（尾部）。

### 22.4 引擎配套改造（E1–E5）

| # | 改造 | 文件 |
|---|---|---|
| E1 | `TurnHookInfo` 增 `worktreePath`（钩子只读采样入参） | seams.ts / session.ts |
| E2 | 提示词面冻结：`live.turnCtx` 会话首采样冻结供提示词组装；UI 状态行仍逐轮刷新；子代理 env 沿用同一冻结副本 | session.ts |
| E3 | context 槽只留稳定内容：核心行删状态计数；git-status / top-level 采集器退役 | session.ts / prompts.ts |
| E4 | 工具面名字序确定性迭代 | registry.ts |
| E5 | thinkingDirective 归一：`composeSystemPrompt` / `composeSubagentPrompt`（增 thinking 参）组装侧各一次，builtinLoop 不再追加（顺带修掉插件适配循环收到双份的问题） | prompts.ts / subagents.ts / loop.ts |

**顺带修复的两个 P1（历史完整性，缓存工作的前置——前缀断即全断）**：

1. **会话文件 messages 从未持久化（createTask 路径）**：`live.messages` 与 `live.sessionFile.messages` 未建立数组别名，防抖保存（scheduleSave → saveSessionFile）写盘的 messages 恒为空——任务重启即丢全部对话记忆（journal 仅够 UI 回放）、`@任务` 引用读不到内容。修复：ensureLive 统一 `live.sessionFile.messages = live.messages` 别名（压缩/清空/序列自愈均为就地变更，别名不破）。回归 = E1"会话文件 messages 持久化"断言。
2. **防抖窗口内快速续跑丢历史**：resumeTask 每次从磁盘 loadSessionFile，轮末 250ms 防抖未 flush 时磁盘落后于内存，ensureLive 用陈旧数组整体覆盖 live.messages。修复：resumeTask 保留较长的一份（内存优先）再进 ensureLive。该缺陷被 E10 捕获（轮 2 请求只剩 system+单条 user）。

### 22.5 已知断点（可接受，非缺陷）

- 自动压缩：摘要替换旧历史 → 一次全量 miss，此后前缀重新稳定（计划性）；
- 模式切换 / 思考档调整 / 装包 / AGENTS.md 修改 / `/clear`：用户显式动作，一次断点；
- 应用重启续跑：冻结副本在内存，重启后重新冻结（期间工作区若变化则一次断点）；
- 多钩子产物合并为宿主包裹的单条 user 消息——形状稳定。

### 22.6 验收（smoke-agent-e2e E10）

1. 三轮会话（跨两次续跑、期间新建文件）共 5 次模型调用，系统提示词**字节一致**；
2. 工具面定义 JSON 跨调用一致（E4 断言）;
3. 第 3 次调用的 prompt 数组逐元素等于第 5 次的前缀（append-only 结构断言）；
4. 基线提醒出现在第二轮请求、变更提醒（顶层新增 c.txt）出现在第三轮请求、基线全程恰一次；
5. 回归：全套 smoke 通过（E1 角色断言加 reminder 过滤后恢复确定性）。

### 22.7 明确不做

- 不做跨会话/跨任务前缀共享优化（通用提示词段前缀已天然共享）；
- 不做 provider 侧显式缓存控制 API（Anthropic cache_control breakpoints 留待模型档案层出现真实需求）；
- 不改 journal / 会话文件格式（冻结副本不入盘，重启重冻结）;
- 不做命中率调优面板（cacheRead / cacheHitRate 已在 usageHistory 与任务 DTO 暴露）。

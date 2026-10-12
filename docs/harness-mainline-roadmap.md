# Gitter 主力 Harness 差距分析与 M1–M3 主线路线

> 状态：定稿 v1.1（2026-10-12）——差距分析 + M1–M3 路线裁决 + **M1–M3 实施进度（当日完成）**
> **实施进度（2026-10-12，当日落地）**：
> - **M1.1 Provider 认证抽象 + 订阅 OAuth** ✅——`shared/types.ts` 增 `OAuthProfileConfig` + 档案 `authKind/oauth/pricing`；`services/oauth.ts`（PKCE + 本地回环登录 + safeStorage 令牌仓 + 刷新，加密器注入可测）；`provider.ts` 增 oauth bearer 通道（anthropic 剥 x-api-key 换 authorization 头）；`models.createSubscriptionPreset`（Claude 订阅预设一键建档，端点可改）+ `models.oauthLogin/Status/Logout` RPC；设置页模型区订阅卡（登录/登出/单价）。
> - **M1.2 Pre/Post-Tool 钩子** ✅——`seams.ts` 增 `ToolHookDef（when: pre-tool|post-tool）`注册表 + `runPreToolHooks/runPostToolHooks`（2s 超时/异常跳过）；`registry.ts` 门序插桩：规则 deny → 模式/分级授权 → **pre-tool 钩子（block 拦截）** → 执行 → **post-tool 注记**；`settings.agentsToolHooks` 总开关；审计视图增 `toolHooks`。
> - **M1.3 用量仪表盘** ✅——`services/agents/usage.ts` 聚合（账本 + usageHistory → 按天/模型/任务/费用）；`agent.usage.report` RPC（allProjects 扫全部项目）；设置页新「用量统计」节（汇总/按天/按模型/按任务表）。
> - **M1.4 冲突闭环** ✅——`services/gitops.ts`（operationState 探测 merge/rebase/cherry-pick/revert + abort/continue，`-c core.editor=true` 免交互）；`git.ops.state` / `git.rebaseAbort|Continue` / `git.mergeAbort|Continue` RPC；变更页操作横幅（继续/中止）+ **逐块冲突解决器**（`ConflictAssist.tsx`：三态决策/两侧保留/写回暂存）。
> - **M1.5 Headless 入口** ✅——`app/src/headless.ts` + main.ts `run` 子命令分支：`npm run cli -- run --repo <path> -p "..." [--yolo|--mode|--model|--thinking|--task-type|--json|--timeout-sec]`，stdin 管道友好，事件流人读/JSONL 双态，无确认通道自动裁决（授权 yolo 放行/提问取首选项/计划自动批准，全部显式标注）；退出码 0/1/2/3 映射终态。核心仍与 GUI 共享同一 AgentSessionManager（引擎零复制）。
> - **M2.1 会话基线 diff** ✅——`taskDiff/taskDiffText` 增 `base: "baseline" | "head"`；改动页「最新改动」行内双基线切换（任务起点 squash 视角 / vs HEAD）。
> - **M2.2 风险信号面板** ✅——`services/risk.ts` 纯规则（敏感路径家族 / DROP·DELETE·强推等破坏性语句 / 规模与大量删除 / 复用 safety.ts 密钥特征）；`agent.task.risk` RPC；改动页风险汇总条 + 逐文件徽标（悬停列全部信号）。
> - **M2.3 Provenance** ✅（存量确认）——`CommitDTO.assistedBy/sessionId` 与 agent 过滤、Log 会话分组徽标已在库（缺口分析时低估）；本批仅回归确认。
> - **M2.4 审查三态** ✅——`AgentTaskRecord.review`（pending/approved/rejected + comment + at）；`agent.task.review.set` RPC（rejected 自动直投修复轮）；turn 开始按 review.at 一次性注入结论 system-reminder；`review_get_state` 工具合并任务审查与旧反馈文件双通道；改动页审查栏（通过/退回+意见/状态徽标）。
> - **M3.1 自动更新（二轮升级，同日）** ✅——推翻首轮"仅检查"裁决：`services/updater.ts` 封装 electron-updater（检查→下载→重启安装全链路 + 下载进度 evt 广播 + 退出自装）；更新源二相一自动识别（GitHub Releases / generic latest.yml 目录）；关于节完整 UI（检查/下载/进度条/重启并安装，dev 回退仅检查+发布页）；electron-builder publish 占位产出 app-update.yml；smoke-mainline 增 resolveFeed 4 项断言。**发布侧配套（使用者操作）**：每次 release 需上传 latest.yml + .blockmap + 安装包到更新源目录（`npm run release` 产物齐备）或 GitHub Release。
> - **M3.2 CI** ✅——`.github/workflows/ci.yml`（windows-latest：tsc + vite/build-pages + 全套 smoke；seams-f 存量崩溃单列 continue-on-error 观察）。
> - **M3.3 外部 harness 桥复活（最小闭环）** ✅——推翻"外部桥已废止"为"外部任务类型"：`createTask(harness=包贡献 id)` → clijson 传输拉起外部 CLI（事件直通时间线 / 退出合成终态 / 托管 checkpoint / stop 树杀 / resume 带 externalSessionId 重启）；stopTask/resumeTask/isRunning 全链路分支；`examples/com.example.external-harness` 示例包（events 规则映射样例）。
> - **M3.4 多窗口任务驾驶舱** ✅——`services/cockpit.ts`（Bridge 生命周期登记/注销）+ `app.allTasks` RPC + 项目页「进行中的 Agent 任务」区块（4s 轮询、状态色点、审查徽标、新窗口直达）。
> - **M3.5 macOS 跨平台**——按裁决不排期。
> - **顺带修复**：smoke-u2 分级表补漏（agent.task.rename/merge/shellKill、extensions.openFolder 等存量缺口 + 全部新 RPC）；smoke-ui-pages files 页依赖断言弹性化（monaco-nls-zh-cn 第 4 依赖入列）；alternateModel/resolveModel 异步化（OAuth 刷新）全调用点 await。
> - **验证**：app/web 双端 tsc 全绿；web build（vite + 9 内置页包）全绿；smoke 全套回归——smoke / agent-v4(57) / agent-e2e(9 场景) / agent-wrapup / extensions / u2 / seams-bc / seams-def / ui-runtime / ui-pages / md-plugin / **mainline（新增 33 项，M 系列全量）**全绿；seams-f 存量崩溃（ext 循环注册时序，HEAD 基线复现，非本批引入）已记录并 CI 容纳。
> - **遗留（下轮）**：agent-e2e 增补审查三态/外部 harness 场景（mainline 已单测工具面/传输面，编排面未串）；订阅预设端点为社区公开值（claude.ai OAuth），登录流程需真机联调；外部 harness 的 ACP/MCP 传输仍封存；设置导入导出顺延。

> 定位输入：Gitter 要作为日常主力 AI coding harness（对标 Claude Code / Codex / ZCode 的日用座席），而非演示性 agent 面板
> 前置阅读：docs/agent-harness-v4.md（§〇 缺口矩阵 / §二十 全阶段插件化 / §二十二 前缀缓存）、docs/ai-native-redesign.md（§三 验收台）、docs/tool-agent-fusion.md（命题 3）
> 裁决摘要：**引擎面已达标，缺口在"入口"与"出口"**——M1 接住主力（认证 + headless + 钩子 + 冲突闭环 + 用量），M2 赢在验收台（基线 diff + 风险信号 + 溯源 + 审查三态），M3 平台化（更新 + CI + 外部桥复活 + 多窗口驾驶舱）

---

## 一、差距分析（2026-10-12 勘察基准）

### 1.1 结论

Gitter 的引擎面（agent 循环、权限门、上下文压缩、任务生命周期、checkpoint、wrapup 合并闭环、全阶段插件化）已经达到主力 harness 的骨架水准——对标 Codex/ZCode 不再是主要缺口。真正差距集中在四类：

1. **模型接入面太窄**：仅 API Key 直连（openai-compatible + anthropic），无订阅 OAuth，接不住 Claude Pro/Max、ChatGPT 订阅认证——主力日用的高 token 消耗下这是一票否决项；
2. **GUI 之外不可用**：agent 循环在 Electron 主进程内，无 headless/CLI 入口，脚本/git hook/CI 无法调用；
3. **旗舰差异化"验收台"只建了一半**：ai-native-redesign §三的会话基线 diff、风险信号面板、provenance 徽标、审查三态共享大部分未落地（仅 checkpoint trailer 与 A4 反馈直投两个孤点）——而这恰是相对 CLI harness 应该赢的地方；
4. **工程化短板**：无沙箱安全模型成文、无自动更新、无 CI、单窗口单仓库、known-issues/README 落后代码一个世代。

### 1.2 P0（不解决无法当主力）

| # | 缺口 | 证据 |
|---|---|---|
| P0-1 | 模型/认证面：全库无 OAuth，仅 apiKey | `agents/provider.ts`；ModelProfile 仅 baseURL/modelId/apiKey |
| P0-2 | headless/CLI 入口缺失，循环困在 Electron 主进程 | `session.ts` 依赖 Bridge 宿主；smoke 已证明核心可无头跑 |
| P0-3 | 外部 CLI 桥废止的战略再裁决 | `docs/agent-harness-codex.md` ⛔ 已废止；`session.ts` createTask 硬拒非内置 harness |

### 1.3 P1（日用硬体验洞）

- **验收台半成品**：会话基线 diff（"自 agent 开始以来"净 diff）、风险信号面板（纯规则）、provenance 徽标、审查三态人机共享（tool-agent-fusion 命题 3）均未实现；
- **Git 事务面**：冲突解决无行级 Accept（known-issues 2.7 延续）；rebase 失败无 abort/--continue 交互（`gitbranches.ts` rebase 直接抛错）；无 stash；无 cherry-pick/Log 右键菜单；push 无 remote/branch 选择；
- **Hook 面只有 post-turn**：无 pre/post-tool-use 用户钩子，"编辑后自动格式化""禁改路径提醒"做不了；
- **用量/成本不可见**：usageHistory 仅任务内，无按天/模型聚合仪表盘与费用估算；
- **终端 shell integration 缺失**：无 OSC 命令检测（列为 F 顺延，不在本路线）。

### 1.4 P2（规模化前工程债）

沙箱安全模型未成文（terminal_run 裸 spawn，Windows 无 AppContainer 级沙箱，安全模型应成文为"权限门为边界"）；多窗口/跨项目任务总览缺失；无自动更新/签名/settings 导入导出；无常驻 CI；MCP 出站仅 stdio 且默认关；文档清账（known-issues/README 仍旧 WinUI 版叙事）。

---

## 二、M1「接住主力」——实施裁决

**目标**：日常编码工作流可以完全搬进 Gitter。

| # | 项 | 裁决 |
|---|---|---|
| M1.1 | **Provider 认证抽象 + 订阅 OAuth** | ModelProfile 增 `authKind: apiKey \| oauth`；宿主 OAuth 会话（PKCE 授权码 + 本地回环回调 + safeStorage 存 token + 刷新）；内置 Anthropic Claude 订阅档案（`authorization: Bearer` + `anthropic-beta: oauth-*` 头通道）；端点可配（档案级 override），不锁死官方端点 |
| M1.2 | **Pre/Post-Tool 钩子** | 注册表扩 `when: pre-tool \| post-tool \| post-turn`；门序 = 规则 deny → 模式/分级授权 → pre-tool 钩子 → 执行 → post-tool 钩子；pre-tool 返回 `{block, reason}` 拦截并回执模型，post-tool 返回 string 以 system-reminder 附注本轮工具回执；插件 ctx.registerHook 同接缝扩展 |
| M1.3 | **用量仪表盘** | 扫描全部仓库账本 + 会话 usageHistory 聚合为按天/模型/任务三维报表（RPC `agent.usage.report`）；模型档案增价格字段（input/output 每百万 token）估算成本；设置页新"用量统计"视图 |
| M1.4 | **冲突闭环** | 冲突文件行级三态解决（采用当前/传入/两侧，解析 `<<<<<<<` 标记，逐 hunk 决策写回）；`rebase --abort/--continue`、`merge --abort/--continue` RPC + 变更页 in-progress 横幅交互 |
| M1.5 | **Headless CLI 入口** | `node dist/headless.js run --repo <path> -p "<prompt>" [--mode ...] [--model ...] [--json]`——真实依赖宿主（设置文件 + git exec + 工具面 + provider），单任务跑到终态、事件流打印 stdout、退出码映射任务终态；与 Electron 共享 agents 核心，不复制引擎 |

## 三、M2「赢在验收台」——实施裁决

**目标**：把"AI 生产、人验收"做成 Gitter 相对 CLI harness 的胜负手。

| # | 项 | 裁决 |
|---|---|---|
| M2.1 | **会话基线 diff** | 任务改动页新"自任务开始"基线：`git diff <baselineSha>`（工作区 + checkpoint 提交合并净 diff，squash 视角）；与"工作区 vs HEAD"双基线切换 |
| M2.2 | **风险信号面板** | 纯规则零 AI 依赖（延续降级原则）：文件路径规则（env/config/lock/migration/密钥路径）、diff 内容规则（复用 safety.ts 密钥特征 + DROP/rm -rf 类高危语句）、规模规则（单文件 >500 行变更）；文件列表徽标 + 汇总条 |
| M2.3 | **Provenance 徽标** | log 解析 `Assisted-by` / `Gitter-Session` trailer（checkpoint.ts 已打戳），任务改动页 checkpoint 列表与 Log 页行内 agent 徽标 |
| M2.4 | **审查三态正式化** | 任务记录增 `review: {status: pending\|approved\|rejected, comment, ts}`；改动页"通过/退回"按钮；rejected 走既有 A4 直投修复轮（裁决升级为协议）；下一轮 turn 注入审查裁决 system-reminder（命题 3：验收状态成为 agent 输入）；`review_get_state` 工具读同一事实源 |

## 四、M3「平台化」——实施裁决

| # | 项 | 裁决 |
|---|---|---|
| M3.1 | **自动更新** | **裁决修订（2026-10-12 二轮：推翻"仅检查不做自更新"）**——electron-updater（electron-builder 生态，NSIS 通道）完整链路：人触发检查 → 提示 → 下载（进度广播 evt）→ **重启安装**；已下载更新退出时自动安装（autoInstallOnAppQuit）。更新源 `settings.updateCheckUrl` 二相一：`github.com/<owner>/<repo>` → GitHub Releases provider；http(s) 目录（或 latest.yml 全路径自动取目录）→ generic provider（latest.yml + 安装包 + blockmap 差量）。无签名通道以 latest.yml SHA512 校验完整性；仍**不做后台静默下载**（检查/下载均人触发）。dev（未打包）回退为仅检查（semver 比较 + 打开发布页）。electron-builder `publish` 占位保证打包产出 app-update.yml，运行时 setFeedURL 按用户配置覆盖 |
| M3.2 | **CI** | GitHub Actions（windows-latest）：双端 npm ci + tsc 构建 + 全套 smoke 无头回归；PR 与 main 分支触发 |
| M3.3 | **外部 harness 桥复活（最小闭环）** | 推翻"外部桥已废止"为"外部任务类型"：taskType.harness=external 经封存的 clijson 传输拉起用户配置的外部 CLI（命令模板 + stream JSON 事件映射进时间线）；内置循环仍是默认且唯一推荐的 harness；以假 CLI smoke 验证通道语义 |
| M3.4 | **多窗口任务驾驶舱** | 主进程全局任务注册表（跨窗口/跨仓库聚合 active 任务摘要，RPC `app.allTasks`）；项目页"进行中任务"区块 |
| M3.5 | **macOS 跨平台** | **不排期**（个人主力为 Windows；ConPTY/safeStorage/路径耦合深，待生态需要再立项） |

## 五、明确不做（本路线护栏）

- 不做静默自更新与签名（分发模式不变）；
- 不做多 agent 编排调度（反融合边界不变，子代理深度 1 不放宽）；
- 不做 inline 补全/内嵌 chat（ai-native-redesign §九不变）；
- 不做 SQLite 迁移（JSON 账本在当前规模够用，待任务数上万再议）；
- 不放宽"决策可下放，执行不下放"安全不变量（push 恒 each-time、git 写过授权卡）。

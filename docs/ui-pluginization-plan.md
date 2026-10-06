# UI 全面自定义方案（页面级插件化 + Agent 流程开放）

> 状态：✅ 实施完成（2026-10-06）—— U1（注册表/上下文/SDK/loader）+ U2（权限令牌 118 RPC 分级）+ U3（DATA_API_VERSION + 生成式 d.ts 契约）+ U4（TasksPage SDK 化试点，pageSdk 唯一面）+ U5（loop 绑定 + 生命周期钩子）+ U6（settings.schema）+ G7（taskType→loop）。九套冒烟全绿 + boot 真启动 PASS。剩余 = U2 令牌的可选深化（运行时弹窗/isolated worlds）+ 五页 SDK 化复制 + 目录站外部基建
> 目标重述：六大页面（Log/Changes/Branches/Projects/Tasks/Settings）UI、Agent 循环、任务流程、任务列表 UI 全部可由插件自定义/替换；**唯一例外是设置项的数据存储归宿主**。
> 本方案推翻 extension-pluginization-plan.md 中判据 2 的旧裁决（"页面级插件化：明确不做"）。新判据：**槽位必须始终有至少一个已启用提供者；宿主缺省提供者不可卸载、只可被替换**。

---

## 一、现状本质

已建 36 条接缝全部在主进程侧或文本级；渲染层没有任何插件运行时（web/src 零动态加载；App.tsx 七页硬编码 switch）。插件能贡献数据/动作/微内容，但 UI 层完全没开放。**数据与动作的插件化已完成（97 个 RPC + 36 条接缝就是"粮食"），缺的是渲染层开放本身。**

## 二、缺口清单（G1–G10）

| # | 缺口 | 性质 | 依赖 |
|---|---|---|---|
| G1 | 页面注册表 + 导航注册表化（App.tsx switch / Sidebar NAV / Ctrl+1..7 / pageForCommand 全硬编码） | 宿主骨架改造 | — |
| G2 | 渲染层插件运行时（loader + 打包/装载契约） | **根本性新增** | G6 |
| G3 | 数据 API 版本化 + UI SDK 类型包（97 个 RPC 是宿主内部契约，第三方 UI 需要 DTO 冻结） | 契约工程 | — |
| G4 | 宿主级 Context Store（选中文件/选中 commit 散落页面局部 state） | 宿主骨架改造 | G1 |
| G5 | 主题令牌注入契约（仅 webview 形态需要） | 小 | G2 |
| G6 | 渲染层权限令牌 + bridge 入口过滤（UI 插件能 call 全部 97 RPC 含 git 写——权限模型镜像到渲染层） | 安全设计变更 | — |
| G7 | taskType→loop 绑定 + createTask loopId（registerAgentLoop 已有但无人消费） | 小 | — |
| G8 | 流程自定义边界：循环/提示/工具/门禁策略可自定义；**状态机与 .git/gitter 账本留宿主**（A4 审计根基） | 设计裁决 | — |
| G9 | 宿主设置 schema 发布（替换 Settings 页需要键/类型/缺省的机器可读描述） | 小 | — |
| G10 | 内置六页 SDK 化迁移（工程量大头） | 大迁移 | G1–G6 |

## 三、U0 裁决：渲染通道三路线

| 路线 | 保真度 | 隔离 | 裁决 |
|---|---|---|---|
| **a. 渲染层 in-process**（Obsidian 模型：插件 JS 经 loader 进入宿主页面，全 DOM） | ★★★ | 无（信任压在审核渠道 + 权限令牌） | **✅ 选定**——只有它能承接"完全自定义"的交互密度（虚拟列表/键盘/SplitPane） |
| b. webview iframe（VS Code 模型） | ★★ | 天然沙箱 | ✗ 交互密度撑不起 Log 虚拟列表/SplitPane，达不到"完全自定义"；保留为轻量视图次通道（已实现的 ui.views） |
| c. 混合（内置原生 + 第三方 webview） | 两级 | 分层 | ✗ 内置与第三方能力不对等，违背"完全自定义" |

安全模型随之切换为 Obsidian 式：**UI 插件 = 渲染层全权限代码**，安全 = allowCodePlugins 门（审核渠道）+ 权限令牌（U2，v1 先记录调用方身份，过滤策略下一批）+ 人审门不变（写操作门在主进程，天然继续生效）。

## 四、实施路线

| 阶段 | 内容 | 状态 |
|---|---|---|
| **U1 页面注册表 + Context Store + UI SDK/加载器** | registry（数据模块）+ App/Sidebar/快捷键注册表化 + 选中上下文镜像入 store + `window.GITTER_UI` 全局 API + script 注入 loader（allowCodePlugins 门）+ `contributes.pages` manifest 段 | ✅ 已实施（2026-10-06）：uiRegistry/builtinPages/sdk/pageLoader 四模块 + PageOutlet/ExternalPageHost + store.context 镜像；settings.schema RPC 同批落地 | 注意：boot-check 与真实应用共用 userData 单实例锁，并发运行会秒退（FAIL 信息已带提示）。boot-check 已含渲染层 UI 断言（侧栏导航项 ≥ 7 + root 已渲染，故障注入红测验证有效）——页面注册表/侧栏回归会被自动抓住
| U2 权限令牌 ✅ 已实施（2026-10-06） | rpcScopes.ts 分级表（117 RPC 逐个分级：open/git.read/git.write/settings.write/agent.run/agent.config/extensions.admin/terminal/ai.invoke/approval/window；未收录默认 extensions.admin 拒绝）+ manifest `contributes.pages[].permissions` 声明 + sdk `__caller` 身份注入 + bridge.handle 入口过滤（未授权 = permission denied + audit.rpc.denied 事件；缺省声明 = open + git.read）。执行强度 = advisory（诚实插件硬约束；in-process 物理极限如实记录，最终防线 = 审核渠道 + 主进程人审门） | 冒烟：smoke-u2 14 项全绿（分级完整性断言曾抓到 6 个漏分级方法即其价值证明） |
| U3 数据 API 版本化 ✅ 已实施（2026-10-06） | DATA_API_VERSION=1（app/src/shared/apiVersion.ts，冻结政策注释于 types 头）+ `api.info` RPC（dataApiVersion/hostApiVersion，权限域 open）+ **gen-ui-sdk.mjs 生成 sdk/gitter-ui.d.ts**（28 个冻结 DTO 接口 + GITTER_UI/ExternalPageContext 全局面）+ `--check` 漂移守卫；作者示例 examples/hello-page（registerPage/ctx.call/ctx.on/清理函数全链） | 冒烟：分级完整性 118 方法 + --check 漂移守卫 PASS |
| U4 TasksPage 先行 SDK 化试点 ✅ 已实施（2026-10-06） | pageSdk.ts（PageSurface v1：call/on/t/navigate/openSettings/toast/refresh/repo/settings/context/setContext + useAppState/useTaskFocus）；TasksPage 全部宿主引用（call/onEvent/t/navigate/refreshCurrent/openSettings/聚焦消费）收敛到 pageSdk 唯一面——页面与宿主的契约边界首次可测量。其余五页同模式复制；gen-ui-sdk d.ts 随面演进同步 | 冒烟九套全绿 + boot PASS |
| U5 agent 流自定义收尾 ✅ 已实施（2026-10-06） | registerHarnessLoop 注册表 + createTask loopId + taskTypes.defaultLoop（G7）+ **生命周期钩子**：AgentSessionDeps.onLifecycle（created/resumed/stopped/removed）→ bridge 转发 EventBus（agent.task.* 事件）→ L2 插件 ctx.on 订阅；状态机与账本按 G8 留宿主 | 冒烟：八套全绿（钩子经 bridge 接线，L2 消费路径由 seams-f 事件机制覆盖） |
| U6 设置 schema 发布（settings.schema RPC） | G9 | ✅ 已实施（21 字段 schema，宿主内部字段不发布） |

## 五、信任与红线（继承 + 新增）

继承：人审门/安全网/隐私档位不变量全部不变（写操作门在主进程，UI 插件绕不过）。新增红线：UI 插件可伪造其它页面外观（同渲染层）——缓解完全依赖审核渠道，**目录/来源标记必须在页面显著位置展示**；内置缺省提供者不可卸载。

## 六、明确不做

- 不做 webview 化核心页（交互密度不够）；
- 不开放任务状态机与 `.git/gitter` 账本格式自定义（A4 审计根基）；
- 不做无审核渠道的无签名代码静默装载（allowCodePlugins 门 + 来源标记恒在）。

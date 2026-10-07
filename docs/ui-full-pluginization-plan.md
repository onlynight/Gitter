# 全 UI 插件化实施方案（内置七页 → 插件收官）

> 状态：✅ 全部实施完成（2026-10-06，R0–R9）——**七个内置页面全部外置为 gitui.page.* 内置页面包，宿主 bundle 零页面代码**（主 bundle 687KB→284KB）。12 套冒烟全绿（新增 smoke-ui-runtime + smoke-ui-pages）+ boot 真启动 PASS（断言：七槽位全部解析到内置包提供者 + 页面真挂载 + 首导航 = projects）+ audit-completion 归零 + 页面零直连守卫 PASS + DATA_API_VERSION = 3。待人工项：Log 万级提交滚动手感对比（R8 性能门）
> 前置：`ui-pluginization-plan.md` U1–U6+G7 已实施——页面注册表 / 权限令牌（118 RPC 分级）/ DATA_API_VERSION + 生成式 d.ts / pageSdk 试点（TasksPage）/ loop 绑定 / settings.schema
> 目标重述：应用全部 UI——七大页面（Log/Changes/Branches/Projects/Tasks/Bash/Settings）——重构为插件形态：以 `contributes.pages` 内置包随应用分发，经与第三方插件**完全相同**的装载链（PackageStore → extensions.pages → pageLoader → GITTER_UI.registerPage → uiRegistry → 槽位渲染）进入宿主；宿主退守"壳 + 内核组件库 + 运行时"。
> 继承裁决（ui-pluginization-plan.md 新判据）：**槽位必须始终有至少一个已启用提供者；宿主缺省提供者不可卸载、只可被替换**。
> 文档关系：本方案是 ui-pluginization-plan.md 的执行篇（剩余 = 五页 SDK 化复制 → 升级为"七页包化"）；`pluginization-plan.md` §六"不做页面级插件化"的旧裁决维持已推翻状态，其 C/D 类红线收编进本方案 §四内核边界。

---

## 一、现状盘点（代码级探索结论）

### 1.1 已就绪（骨架全通，直接复用）

- **UI 插件全链已通**：`contributes.pages`（schema.ts 73-81）→ `store.pagesOf()` → `extensions.pages` RPC → pageLoader `file://` script 注入 → `GITTER_UI.registerPage` → uiRegistry → Sidebar / Ctrl+1..9 / PageOutlet（examples/hello-page 端到端验证）。
- **权限分级底座**：rpcScopes 11 域 × 118 RPC + bridge `handle()` 入口过滤 + `audit.rpc.denied` + smoke-u2 完整性门。
- **契约工程**：DATA_API_VERSION=1 + gen-ui-sdk.mjs 生成 sdk/gitter-ui.d.ts + `--check` 漂移守卫。
- **内置包机制成熟**：resources/packages 14 个内置包与用户包同 manifest、同扫描/校验/启停/遮蔽路径；内置只能禁用不能卸载，同 id 用户包遮蔽内置。
- **TasksPage** 是唯一 pageSdk 真收敛页（U4 试点）。

### 1.2 缺陷级缺口（必须先修，本方案 R0）

| # | 缺陷 | 位置 |
|---|---|---|
| A1 | **权限令牌断链**：`__caller` 只带 packageId 不带 permissions，bridge 恒按 DEFAULT_PAGE_SCOPES 判定——manifest permissions 目前是元数据不是强制 | sdk.ts:18 / bridge.ts:170 |
| A2 | **清理链断裂**：`__gitterCleanup` 只写不读；包卸载/停用不注销已注册页面；allowCodePlugins 运行中开关不热装载（loader 仅 boot 跑一次） | App.tsx:43 / App.tsx:146 |
| A3 | **内置信任与代码门混同**：allowCodePlugins=false 时 `extensions.pages` 返回 `[]`——内置页面若走包通道会被自家信任门拦截 | bridge.ts:844 |

### 1.3 结构缺口

| # | 缺口 |
|---|---|
| B1 | App.tsx:24 `BUILTIN_COMPONENTS` 硬编码组件身份表——注册表只有"外部不可覆盖内置"，没有"内置页 = 可替换缺省提供者"的语义 |
| B2 | 共享组件层 0% 插件可达：DiffView / SplitPane / Dialogs(Modal/ContextMenu/Banner) / SyncBar / markdown 都不在 GITTER_UI / d.ts 契约内，外部页只拿裸 div + call/on/context 四个函数 |
| B3 | PageSurface v1 缺口：无 `openRepo`（TasksPage 用 setState shim 绕过）；`GITTER_UI.context()` 不含 selectedFile/selectedCommitSha（store 镜像已存在但未暴露）；PageOutlet 兜底硬编码渲染 ProjectsPage |
| B4 | pageForCommand 前缀启发式（store.ts:137）+ Ctrl+Tab 硬编码顺序数组 + `AppState.pages` 死字段 |
| B5 | 包格式缺口：单入口经典脚本、无 CSS 贡献点、页面无 i18n 通道（title 是字面量）、无按需懒装载 |
| B6 | settings.schema 已发布（20 字段）但 SettingsPage 未消费，悬空 |

### 1.4 工程量主体

七页共 3152 行：Log 461 / Changes 678 / Branches 226 / Projects 82 / Tasks 543 / Bash 145 / Settings 1017；五页 + Bash 的 pageSdk 引用仅为标记 import（正文零引用），Bash 完全未接。共享组件 828 行 + 壳 137 行待分层。

---

## 二、目标架构

```
┌ Electron 主进程 ─────────────────────────────────────────────────┐
│ PackageStore：内置页面包 gitui.page.* ×7 + 用户包，同一扫描/校验/启停路径 │
│ rpcScopes 权限分级 + __caller 强制（R0 补全）+ audit.rpc.denied      │
│ 宿主内核：git 引擎 / safety 人审门 / settings 存储 / 扩展系统自身      │
├ preload bridge（不变）───────────────────────────────────────────┤
│ web/ 渲染层                                                       │
│  壳（宿主私有）：TitleBar / Sidebar / StatusBar / CommandPalette      │
│    / PageOutlet / uiRegistry（槽位-提供者解析）/ store / pageLoader  │
│  内核组件库 GITTER_KIT：React、ReactDOM（单例 externals）+ DiffView    │
│    / wordDiff / SplitPane / Dialogs / SyncBar / markdown            │
│  内置页面包 ×7（独立 IIFE 产物，resources/packages/gitui.page.*，      │
│    懒装载 → registerPage → mount(el, ctx) → React root）             │
│  用户 UI 插件（同链路装载；allowCodePlugins 门 + permissions 强制）    │
└──────────────────────────────────────────────────────────────────┘
```

**槽位-提供者模型**（uiRegistry 升级）：

- 每个页面槽位（log/changes/…）可有多提供者；解析优先级：**用户包 > 内置包**（同 id 遮蔽语义从包级延伸到页面级）。
- 注册 id 保持 `ext.<pkg>.<pid>` 命名空间防碰撞；`contributes.pages[].slot` 字段（可缺省 = 自身 id）声明竞争的槽位——第三方"替换 Log 页"即声明 `slot:"log"`。
- 内置包提供者 = 缺省提供者：**不可卸载**（包级语义已有）；**不可在无替换者时停用**（见 D4）。
- 槽位加载失败（脚本异常/超时）→ 槽位级 ErrorBoundary 错误卡 + "重载页面"按钮，**不静默回退**（诚实呈现，失败原因可见）。

---

## 三、关键裁决

### D1 内置页的插件形态：真外置（独立 IIFE 产物），不做"身份外包"

| 路线 | 内容 | 裁决 |
|---|---|---|
| **a. 真外置** | 每页构建为独立 IIFE bundle，作为内置页面包落在 resources/packages，经 pageLoader 装载，与第三方插件同链路 | ✅ **选定**。理由：①"所有 UI 按插件形式重构"的唯一诚实形态，页面↔宿主边界物理可测（bundle 不含宿主代码即验收）；②U1–U3 的 loader/权限/契约底座正是为此而建；③身份外包会让内置页永远存在"绕过契约的直连后门"，边界不可测量，U4 的收敛成果随批回退 |
| b. 身份外包 | 组件留在宿主 bundle，仅把身份/启停/元数据交给内置包 | ✗ 作为 D1 的风险预案保留：若 R2 管线验证暴露不可控成本（见 §七风险表首行），降级为 b，R1 的 SDK 化成果独立保值 |

### D2 运行时共享：GITTER_KIT window 全局 + 构建期 externals，单例白名单

- **单例 externals 白名单 = react、react-dom**（useSyncExternalStore/事件系统要求单实例），经 `window.GITTER_KIT` 提供；构建脚本断言页面产物内**不得含 react 拷贝**（产物 grep + 尺寸断言）。
- 其余依赖按"页内私有的随意打"原则：@tanstack/react-virtual、xterm、markdown-it 等非单例库允许随页打包，不进 KIT。
- KIT 组件（DiffView/wordDiff/SplitPane/Dialogs/SyncBar/markdown）**单一源码、两种制品**：宿主 bundle 内 ES import（零间接），外部页经 window.GITTER_KIT（vite lib mode 产出 kit.iife.js）。类型面进 gen-ui-sdk 一并生成。
- KIT 是**可复用组件**不是**可替换引擎**：DiffView 字级 diff/虚拟滚动实现不开放替换（C 类红线延续），插件只能"用"不能"换"。

### D3 内置信任与代码门分离

allowCodePlugins 语义收窄为**用户代码插件门**：`extensions.pages` 返回与 pageLoader 装载均改为"内置页面包恒装载（信任随应用分发，与现有内置 L2/主题包同语义）；用户页面包受门控"。内置页面包不声明顶层 `entry`（无 L2 主进程代码），只有 contributes.pages 渲染层入口——主进程信任面不扩大。

### D4 停用守卫：最后一个提供者不可停用

`extensions.setEnabled(false)`（含 kinds.pages=false）在目标包贡献的某槽位停用后将无任何已启用提供者时**拒绝并返回原因**，设置页 chips 显示原因（禁用态置灰 + tooltip）。替换语义：用户包启用并声明同 slot 后，内置包即可正常停用。加载失败≠停用：失败走错误卡，不影响停用规则。

### D5 权限令牌闭环 + 内置页面宽权限显式化

- R0 修复 A1：pageLoader 把 manifest permissions 传入 sdk，`__caller` 携带 `{packageId, permissions}`，bridge 按声明强制（缺失回退 DEFAULT_PAGE_SCOPES 语义不变）。
- 内置页面包 manifest 显式声明各自完整 RPC 面（如 gitui.page.changes 声明 git.write/ai.invoke/approval/…）——这同时是每页 RPC 足迹的自文档；冒烟静态断言"声明 ⊇ 实际调用"（仿 smoke-u2 完整性门做法）。
- 用户替换包照常走安装时权限明示。advisory 强度定位不变（in-process 物理极限如实记录，最终防线 = 审核渠道 + 主进程人审门）。

### D6 页面生命周期：懒装载 + 真清理 + 热刷新 + 错误边界

- **懒装载**：侧栏/快捷键元数据在 boot 时从 PackageStore 同步取得（导航零延迟）；页面 entry 脚本**首次导航到该页时**注入并缓存（7 页脚本不再全量 boot 注入）。用户页缺省 eager，维持现行为。
- **真清理**：PageOutlet 卸载外部页时调用 mount 返回的 cleanup（修复 `__gitterCleanup` 断链与 sdk.ts `void off` 死代码）。
- **热刷新**：包集合变化（refreshExtensions：导入/卸载/启停/allowCodePlugins 切换）→ 主进程推送事件 → 渲染层注销该包页面并按需重载；当前页被注销时回落到解析序下一个提供者。
- **错误边界**：每槽位 ErrorBoundary；崩溃只塌本页，壳不倒。

### D7 SettingsPage 形态：schema 驱动通用渲染器 + 三个复杂节组件

默认设置页包 = ① 消费 settings.schema RPC 的通用表单渲染器（B6 闭环，含配置贡献自动渲染）+ ② 三个仍以组件实现的复杂节：扩展管理卡（含 allowCodePlugins 总门——**扩展页管理扩展自己**，最佳自举验证）、gitconfig 双层编辑、模型档案 CRUD。**红线不变**：settings.ts 存储、信任门裁决在宿主；页面只是 settings.write 域的消费者。

### D8 Bash/Terminal 页：引擎留宿主，前端随包

node-pty 会话管理/ConPTY 生命周期（C 类性能红线）留宿主；xterm.js 前端组件随 gitui.page.bash 包（xterm 非单例库，随页打包），主题热切换走既有 CSS 变量。

### D9 契约版本策略：R1 末一次性 bump

PageSurface v2 + GITTER_KIT + context() 扩面在 R1 稳定后 DATA_API_VERSION → 2、gen-ui-sdk 重新生成并 `--check` 入守卫；R2–R8 期间若契约再破面则按冻结政策逐次递增。manifest apiVersion（HOST_API_VERSION）不动。

### D10 CSS 与 i18n 贡献点

- `contributes.pages[].styles: string[]`（相对包内路径）：pageLoader 装载页面时注入 `<link>`/`<style>`，卸载时移除；约定页面根类名 `.gpage-<slot>` 防跨页污染；宿主设计 token（CSS 变量）是只读公共层，页面包不自带 token 覆盖。
- 页面 i18n 复用包 i18n 通道：`title: "%key%"` 由装载方解析；`ctx.t(key)` = 包词条 → 宿主字典回退（仅 en/zh-Hans，与命令 i18n 同范围）。

---

## 四、宿主内核边界（永不插件化红线）

继承 pluginization-plan.md B/C/D 类裁决，按新判据收编：

| 内核 | 理由 |
|---|---|
| 壳：TitleBar / Sidebar / StatusBar 容器 / CommandPalette 组件 / PageOutlet / uiRegistry / store / pageLoader | 骨架与导航是槽位的定义者；骨架插件化 = 禁用一个插件整个 UI 塌陷 |
| DiffView / wordDiff / SplitPane 等内核组件**实现** | 每帧滚动性能红线；经 KIT 可复用、不可替换 |
| git 引擎读写层 / rpcScopes / safety 人审门 / approval | 权限系统的执行权侧，保护者不能成为被保护者 |
| settings.ts 存储 / 扩展系统自身 / i18n 宿主层 | A 类自举死结 |
| node-pty 终端引擎 / agent 循环与会话账本 / checkpoint | 性能与审计根基 |

---

## 五、实施批次（每批独立可交付、可回滚）

| 批次 | 内容 | 规模 | 验收门 |
|---|---|---|---|
| **R0 ✅ 已实施（2026-10-06）** | 契约与运行时补课（§5.1，8 项全落）：checkCallerAccess 权限闭环 / 槽位-提供者注册表（uiRegistry 重写：slot+三级解析+惰性元数据升级）/ 停用守卫（setEnabled/setKindEnabled/uninstall 三处 + soleProviderSlotsAfterDisable 纯函数）/ 生命周期（ExternalPageHost cleanup 真调用 + extensions.changed 热重同步 + PageErrorBoundary）/ PageSurface v2（openRepo/closeRepo/updateSettings/applySettings/clearSettingsFocus/reloadTheme/focusTask/clearTaskFocus/theme + context.changed 本地通道）/ GITTER_KIT（kit/ 单一源 + vite.kit.config.ts → dist/kit.iife.js 259KB + window 全局 + SplitPane persist 键开放）/ loader 重写（内置免门过滤在 bridge + 惰性装载 + styles 注入 + 卸载清样式 + 标题 %key% 经 CommandRegistry.resolvePageTitle）/ 导航收尾（命令路由显式 page 参数 + Ctrl+Tab 走注册表 + 兜底走首个槽位） | 大 | 11 套冒烟全绿 + smoke-ui-runtime 20 项 + boot PASS（GITTER_UI/KIT/logSlot=builtin 断言） |
| **R1 ✅ 已实施（2026-10-06）** | 七页全量 pageSdk 化：Log/Changes/Branches/Projects/Settings/Tasks/Bash 全部删除 bridge/client 与 state/store 直连（唯一面 = pageSdk + kit）；TasksPage setState shim 被 openRepo 收编（worktree 打开从本地伪造 repo 状态变为真 projects.open）；新增 scripts/check-page-imports.mjs 零直连守卫 | 大（机械） | 守卫 PASS + web tsc/vite 构建（主 bundle 687KB + kit 259KB）+ 全套复跑绿 |
| **R2 ✅ 已实施（2026-10-06）** | 页面包化基建：宿主面单一源（surface.ts）+ GITTER_UI 全量面 + window.GITTER_KIT 宿主组装（架构裁决见 §九）+ external/* 适配层 + build-pages.mjs + gitui.page.projects 首迁 | 大 | smoke-ui-pages 全绿 + boot 断言 |
| **R3 ✅ 已实施** | BranchesPage 包化（7KB 产物） | 小 | 同上 |
| **R4 ✅ 已实施** | TasksPage 包化（16KB 产物；worktree 打开走真 openRepo） | 小 | 同上 |
| **R5 ✅ 已实施** | Bash 页包化（290KB 产物，xterm 随页打包；node-pty 引擎留宿主） | 小 | 同上 |
| **R6 ✅ 已实施** | ChangesPage 包化（15KB 产物；27 个 RPC 足迹 ⊆ 声明） | 中 | 同上 |
| **R7 ✅ 已实施** | SettingsPage 包化（32KB 产物；扩展卡管理扩展自身=自举验证；NavIcon 随包经 KIT 消费） | 大 | 同上 |
| **R8 ✅ 已实施** | LogPage 包化（37KB 产物 + @tanstack/react-virtual 随页；懒装载=性能收益。性能门待人工滚动对比） | 大 | 冒烟 + boot（性能门见 §九） |
| **R9 ✅ 已实施** | 收尾：删 BUILTIN_COMPONENTS 与宿主页面 import（产物断言=smoke-ui-pages c 段）、boot 断言强化（七槽位 builtin-package + 页面真挂载 + 首导航排序）、契约 v3 | 小 | 全套绿 |

> 迁移顺序逻辑：Projects（82 行）验证管线 → 小页铺量 → Changes/Settings（复杂交互与自举）→ Log 压轴（交互密度最高 + 万级虚拟列表性能门）。TasksPage 因 SDK 面最熟，排在 Branches 后尽早收编 shim。

### 5.1 R0 明细（契约与运行时补课，全部是后续批次的地基）

1. **权限令牌闭环**（D5/A1）：loader→sdk 传 permissions，`__caller` 携带，bridge 强制。
2. **槽位-提供者注册表**（§二）：UIPageDef + slot/priority；`registerUiPage` 从"禁止覆盖内置"改为三级解析（用户包>内置包>宿主遗留兜底，迁移期过渡态）；删 `AppState.pages` 死字段。
3. **停用守卫**（D4）：bridge `extensions.setEnabled` + 设置页原因呈现。
4. **生命周期**（D6/A2）：cleanup 真调用、refreshExtensions→渲染层热注销/重载、槽位 ErrorBoundary。
5. **PageSurface v2**（B3）：+`openRepo(path)`/`setPage(id)`（收编 TasksPage setState shim）、`context()` 扩 selectedFile/selectedCommitSha、`context.changed` 事件。
6. **GITTER_KIT 抽出**（D2/B2）：web/src/components → web/src/kit 单一源 + kit.iife.js 制品 + window 全局；SplitPane persist 键开放（现字面量联合仅 log/changes）。
7. **loader 增强**（B5/A3）：内置包恒装载 + 用户包门控分离；懒装载；styles 注入；页面 title %key% 解析。
8. **导航注册表收尾**（B4）：命令元数据加 targetPage（pageForCommand 去前缀启发式）、Ctrl+Tab 按 uiPages() order、PageOutlet 兜底从"硬编码 ProjectsPage"改为解析序规则。

### 5.2 每页包化批次的固定动作（R2–R8 模板）

建包（manifest：contributes.pages + styles + i18n + 完整 permissions 声明）→ 构建产物进 resources/packages/gitui.page.<slot> → pageLoader 懒装载验证 → 冒烟/boot 绿 → **删除宿主 bundle 内该页组件与其直连** → 提交。任一批可独立 `git revert` 回滚；槽位 ErrorBoundary 兜底装载失败。

---

## 六、验收基线与冒烟

| 检查 | 内容 |
|---|---|
| smoke-ui-runtime（新增） | __caller 权限强制（声明内放行/越权拒绝/缺省回退）、cleanup 链、包刷新热注销、停用守卫（最后提供者拒绝/有替换放行）、内置页面包不受 allowCode 门影响、懒装载首次导航注入 |
| smoke-ui-pages（新增） | 七个内置页面包 manifest 校验 + pagesOf() 全返回 + **声明 permissions ⊇ 页面源码实际 RPC 调用面**（静态 grep 断言，仿 smoke-u2） |
| 页面零直连守卫（R1 起） | pages/**/*.tsx 不得 import store/bridge/client（脚本断言，唯一面 = pageSdk + KIT） |
| boot-check（增强） | 现有 nav≥7 + root 渲染断言保持；增补：默认槽位解析正确 + 至少一个内置包页面 mount 成功 |
| 性能门（R8） | LogPage 万级提交滚动与 diff 渲染：长任务计数/帧率对比迁移前基线，不劣化 |
| 既有九套冒烟 + `--check` 漂移守卫 | 每批全绿（含"内置走接缝"自举断言文化：断言内置页面经 pagesOf() 而非硬编码表） |

---

## 七、风险与对策

| 风险 | 对策 |
|---|---|
| 多 React 实例（页面各自打包带 react 拷贝 → store 订阅断裂/hooks 报错） | externals 单例白名单 + 构建产物断言（grep/尺寸）；这是 R2 管线验证（ProjectsPage）的第一验证点，失败即触发 D1 降级预案 b |
| 启动性能（7 页脚本全量注入） | 懒装载（首次导航注入）；导航元数据 boot 同步来自 PackageStore，侧栏零延迟 |
| 打包 asar 后 file:// script 失效 | 本期不打 asar 维持现状；打包时 asarUnpack packages 目录或换自定义协议（GITTER_RESOURCES 出口已预留，列入打包前检查单，不在本方案解决） |
| Log 迁移性能回归 | R8 独立批次 + 性能门 + 可单独 revert |
| 跨页样式污染 | 包 styles 注入 + `.gpage-<slot>` 命名空间约定 + 宿主 token 只读 |
| 契约漂移（PageSurface/GITTER_KIT/GITTER_UI 三面失同步） | gen-ui-sdk 单源生成扩面覆盖三面 + `--check` 入每批冒烟 |
| 内置页面宽权限与最小权限叙事冲突 | 定位如实：内置信任 = 随应用分发（与现有内置包同语义）；用户替换包安装时权限明示；advisory 极限已在 U2 记录 |
| 迁移期回归面大 | 每页一批一提交可回滚；ErrorBoundary 兜底；九套冒烟 + boot 每批必绿 |

---

## 八、明确不做

- **不插件化壳**：TitleBar/Sidebar/StatusBar 容器/命令面板本体/路由出口/loader/store 仍属宿主（D 类裁决延续；壳内插槽 statusbar/面板/视图容器已开放，维持现状）。
- **不开放内核组件引擎替换**：DiffView/虚拟列表实现不可被页面插件替换（KIT 只供复用）。
- **不动宿主内核**：git 引擎、settings 存储、扩展系统自身、人审门/安全网裁决、任务状态机与 `.git/gitter` 账本、node-pty 引擎。
- **不做 webview 化核心页**（U0 裁决延续）；**不做无审核渠道的用户页面静默装载**（allowCodePlugins 门恒在）。
- **不做页面间依赖图/插件间服务发现**：页面通过槽位与全局 context/事件协作，不引入 Cordis（触发信号维持 extension-system-v2 §六原判）。

---

## 九、实施记录（与方案的偏差备忘）

- **D2 React 面的最终形态**：kit.iife.js 自带 react/react-dom 生产拷贝（259KB），外部页 React 树自包含、不与宿主组件树共享实例——数据面经 ctx.call/on 纯 JS 通道，跨实例安全；宿主 bundle 继续从源码 ES import（两制品并存是有意设计）。React 实例隔离因此比原方案更保守，多实例问题在 R2 管线验证中已被结构性消除。
- **lib 构建陷阱**：vite lib/iife 不继承主构建的 `process.env.NODE_ENV` define——kit 配置必须显式注入 production（react dev 分支因此未 Tree-shake 时曾到 589KB，修复后 259KB）。
- **内置页面包的 slot 必须显式声明**（如 `"slot": "log"`）：缺省槽位 = `ext.<pkg>.<pid>` 自身——停用守卫按槽位判定，不声明 slot 的"内置页面包"不会被当作缺省提供者。
- **PageSurface v2 实际面**比方案多出 closeRepo/applySettings/clearSettingsFocus/focusTask/theme（七页收敛过程中暴露的合法宿主写入口）；GITTER_UI 面同步扩了 navigate/openSettings/toast/openRepo/context 扩面，DATA_API_VERSION 已按 D9 递增为 2。
- **openRepo 语义统一为 projects.open**（repo.open + 记入项目列表），Projects/Tasks/GITTER_UI 三处行为一致。
- **页面标题 i18n（D10）**：`%key%` 解析在 bridge 侧 extensions.pages 完成（复用 CommandRegistry 包 i18n 字典，lang → en → 原样），loader 不感知。
- **R2 待补的已知缺口**：外部页 ctx 尚无 `t()`（页面 i18n 只覆盖标题，页面内文案待补 ctx.t 或 KIT 层 i18n）；SettingsPage 的 NavIcon 仍 import 宿主 Shell（R7 外置时随节组件一起处理）。

### R2–R9 实施记录（2026-10-06）

- **架构裁决（对 D2 的修正，更优）**：放弃独立 kit.iife 制品——R0 的 kit.iife 内嵌了 store/bridge 的**死副本**（DiffView 的 useApp/t 读不到活 store，i18n 全断），且自带 React 拷贝会与页面 React 实例分裂。改为**宿主 bundle 即 KIT 制品**：`kitGlobal.ts` 启动时把宿主 React（单一实例）+ kit 组件挂到 `window.GITTER_KIT`；页面构建（web/scripts/build-pages.mjs）把 react/jsx-runtime/react-dom(+/client) 声明为 `GITTER_KIT.*` globals external。三方（壳/内核组件/页面）共享同一 React 与活 store。
- **宿主面单一源**：PageSurface 实现收敛到 `web/src/surface.ts` 的 `hostSurface(call,on)`——pageSdk（内置语义，直连）与 window.GITTER_UI（外部语义，__caller 注入）同实现，`t/getState/subscribeState/runCommand` 一起上面；外部页 React 面 = `useSyncExternalStore(GITTER_UI.subscribeState, GITTER_UI.getState)`（跨实例安全的纯 JS 订阅）。
- **页面构建**：`../pageSdk`/`../kit`/`../commands` 三个相对导入在页面构建期映射到 `src/external/*` 适配层；bridge/types 类型导入擦除；页内私有依赖随页打包（log+tanstack 37KB、bash+xterm 290KB、settings 32KB、changes 15KB、tasks 16KB、branches 7KB、projects 3KB）。`emptyOutDir:false`——manifest/i18n 是随包静态资源（曾把 manifest 清掉，冒烟抓到）。
- **内置页面包**：`gitui.page.{projects,log,changes,branches,tasks,bash,settings}` 七包，manifest 声明 `slot`+`lazy:true`+`svg`（schema 新字段，侧栏双图标形态）+ 完整 permissions 足迹 + `%Nav_*%` 标题（包 i18n en/zh-Hans）；顺序继承内置身份登记（builtinPages）——包元数据硬编码 order 会把导航顺序打乱（boot 首导航断言防回潮）。
- **权限足迹静态门**：smoke-ui-pages 逐页 grep `call("...")` + surface 面补充 RPC，经 RPC_SCOPES 映射后断言 ⊆ manifest 声明（曾抓到 tasks 缺 git.read）。
- **失败回退链**：装载失败 → loader `markLoadFailed`（lazy=false 终态）→ PageOutlet 落到"页面不可用"卡（不静默重试）；包停用走 D4 守卫（唯一提供者不可停用）。
- **权限 denied 事故与修复（2026-10-06 实机验收发现）**：外置后终端页报 `permission denied: terminal`、设置页扩展启停报 `extensions.admin`——两处根因叠加：① `makeCtx` 在**挂载时**读 `loadingPermissions` 模块变量（loader 注入完成后已被 `endExternalPackage` 重置）→ 恒回退缺省权限；② 七页真正走的 `window.GITTER_UI.call`（顶层 surface）同样绑定装载期变量。修复 = 权限在**注册/装载期窗口**捕获：registerPage 闭包捕获（`makeCtx(packageId, permissions)`，救 ctx.call 路径）+ 适配层在入口脚本 eval 期 `getActiveCaller()` 捕获 BOOT caller、此后全部调用走 `callWith(caller, …)`（救 pageSdk.call 路径）。新增 `scripts/e2e-pages-check.mjs` 金丝雀（真点击终端页断言 terminal 域放行）+ smoke-ui-runtime 静态断言双防回潮。教训：__caller 的生命周期 = 装载期窗口，任何"调用时再读"的写法都是错的。
- **图标丢失事故（同期发现）**：metaToDef 只透传 `svg` 没透传 `icon`（glyph）——projects/tasks/bash/settings 四个字形图标断链；Sidebar 重写时 settings 齿轮 glyph（Segoe 私用区字符，代码审读时显示为空白被抄成空串）丢失。修复 = icon 字段打通 pagesOf→loader→metaToDef，settings 导航身份改从注册表胜出者取；smoke-ui-pages 增"七包图标齐备"断言。
- **双分隔线（同期发现）**：extNav 为空时上下两条 `.nav-sep` 相邻渲染。修复 = 外部页区块条件渲染（无外部页不出分隔线）。
- **R8 性能门如实记录**：懒装载本身是启动收益（主 bundle 687→284KB，七页按需注入）；"万级提交滚动不劣化"需真机人工对比，未自动化——回滚手段 = git revert 单页包 + boot 断言。
- **boot 断言终态**：GITTER_UI/GITTER_KIT 已装 ∧ 七槽位全部解析到 `isBuiltInPackage` 提供者 ∧ 当前页真挂载（.toolbar 存在）∧ 首导航 = projects ∧ nav ≥ 7。


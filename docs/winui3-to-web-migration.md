# WinUI 3 → WebView2 + Web 前端迁移方案

> 状态：设计 v1（2026-10-05，dev 分支）—— 仅设计未动代码，动工前需过 §12 开放问题的拍板
> 结论输入：WinUI 3 与"信息密集 + 高度定制"的产品形态错配（提交史 21% 为 UI 框架对抗性修复；InfoBar/ConPTY/文件对话框环境性 fail-fast；UIA 冒烟依赖中文文案与独占桌面不可并行；自绘终端/滚动条/TextMate 子集均为框架空白的低配补造）。
> 定位：**不是重写产品，是更换 UI 执行栈**。git 能力层、规则引擎、AI/MCP、PTY 桥接全部保留；只重写一直在流血的 UI 层（约 8.7k 行 C# + 1.4k 行 XAML）。
> 前置阅读：docs/design.md（总设计）、docs/ai-native-redesign.md（AI 原生重设计）、docs/known-issues.md（技术债台账，§五环境黑名单是本方案直接动因之一）

---

## 一、为什么是 WebView2 混合，而不是别的

备选路线对比（结论：WebView2 混合是唯一同时满足"保住 .NET 资产"与"拿到 web UI 生态"的路线）：

| 路线 | 保住 15.6k 行 .NET 域逻辑 | web UI 生态 | 运行时分发 | 结论 |
|---|---|---|---|---|
| **WebView2 混合（本方案）** | ✅ 原地保留 | ✅ 完整 | evergreen 随 Win10/11 预装 | **采用** |
| Electron 全迁 | ❌ 需 sidecar 或重写 git 层 | ✅ 完整 | 需捆绑 Chromium（+~200MB） | 无增益，弃 |
| Tauri + .NET sidecar | ⚠️ 进程拆两半 | ✅ 完整 | 系统 WebView（Windows 上就是 WebView2） | 与混合路线同价但多一层进程模型，弃 |
| Avalonia / WPF | ✅ | ❌ 仍要对抗样式/自绘终端 | 无 | 主题与测试生态比 WinUI 好，但自绘终端/diff 的账一点不少，作为 Plan B |
| 维持 WinUI 3 | ✅ | ❌ | 无 | 框架税持续复利，roadmap（验收台/任务卡/活动流）全是自定义 UI，弃 |

关键事实支撑（已核实）：
- `GitUI.ViewModels` 是纯 net8.0 类库，仅引用 Core，**零 WinUI 依赖**——ViewModel 层可原样服务新前端。
- `GitUI.Shell` 的终端链路收敛在 `ITerminalSession` 接口（ConptySession / WinPtySession / FakeTerminalSession），字节流进出的接缝天然干净，桥接成本极低。
- `GitUI.Core/Mcp/JsonRpc.cs` 已有 JSON-RPC 消息封包实现，桥协议直接沿用其约定。
- Core 的规则引擎（CommitSafety / RiskHunkMapper / ReviewFeedbackBuilder）、AI、MCP、Agent Harness 全部 headless 可测，与 UI 栈无关。

## 二、目标架构

```
┌─────────────────────────────────────────────────────┐
│ GitUI.App（瘦宿主）                                   │
│  WebView2 控件 + 虚拟域名加载 web/ 构建产物             │
│  平台服务：FolderPicker(SHBrowse) / SecretProtector   │
│           McpPipeHost / AiGatewayFactory / 全局加速键  │
│  WebBridge：JSON-RPC 命令/事件 + PTY 二进制通道         │
└──────────────┬──────────────────────────────────────┘
               │  桥（§三协议）
┌──────────────┴──────────────────────────────────────┐
│ web/（TypeScript + React + Vite）                     │
│  壳：侧边导航 / 命令面板 / 横幅 / 右键菜单 / 分割条      │
│  页：log / changes / branches / projects / tasks /    │
│      terminal / settings                              │
│  组件：DiffViewer / VirtualList / xterm.js 封装        │
│  主题：CSS 变量（消费 C# 下发的语义令牌）                │
└─────────────────────────────────────────────────────┘
不变：GitUI.Core / GitUI.Git / GitUI.Shell / GitUI.ViewModels + 全部 headless 测试
```

职责划分原则：**C# 是唯一事实源**（git 状态、diff 计算、令牌取值、设置持久化、PTY 字节、i18n 服务端消息键）；前端只做渲染与交互。前端不直接碰文件系统/进程/注册表——所有能力经桥，宿主不暴露 host object 的细粒度面（仅 `Invoke(method, json)` + 事件回调），CSP 禁远端、release 禁 DevTools。

## 三、桥协议（WebBridge）

### 3.1 消息形态

沿用 JSON-RPC 2.0 封包（与 McpPipeHost/JsonRpc.cs 同约定）：

- **命令**（JS → C#）：`{id, method: "log.query", params}` → `{id, result}` / `{id, error: {code, messageKey, args, detail}}`。
  错误消息一律**服务端发键 + 参数**（`messageKey` 指向 Strings.tsv），前端本地化渲染——禁止服务端发成品文案。
- **事件**（C# → JS）：`{method: "event/<域>.<名>", params}`。来源为既有 ViewModel 事件（`context.Changed`、`BranchListChanged`、transient 消息等）与 RepoMonitor/AgentHarness 活动流。
- **PTY 字节流**（独立通道，不走 JSON）：
  - C# → JS（输出，量大且突发）：WebView2 **SharedBuffer**（`PostSharedBufferToScript`），降级路径 base64 分块（每块 ≤64KB）；
  - JS → C#（键入，量小）：`chrome.webview.postMessage` JSON 内嵌 base64（每次几个字节，编码开销可忽略）。

### 3.2 API 面（契约先行）

桥不是 ViewModel 的直接远端透传，而是**显式冻结的 API 契约**，按域分组：`repo.*`（打开/关闭/状态）、`log.*`（查询/分页/分支列表）、`changes.*`（status/stage/unstage/hunk/commit/push/pull）、`branches.*`、`worktree.*`、`terminal.*`（会话生命周期/写入/resize/选区上报）、`settings.*`、`theme.*`（令牌表全量 + 变更事件）、`i18n.*`（语言包 + 变更事件）、`ai.*`（提交信息生成/解释/活动流订阅）、`mcp.*`（宿主状态）、`platform.*`（选目录等原生对话框，调用后宿主跑原生 UI，结果回传）。

实现上每域一个 Adapter 类薄封装对应 ViewModel / 服务方法（预计每域 50–150 行）。TS 侧类型与 C# DTO 的同步采用**单源代码生成**：扩展 `gen-localization.ps1` 思路，新增 `gen-bridge.ps1` 从 C# DTO 程序集反射生成 `bridge-types.d.ts`；契约测试保证两端不漂移。

### 3.3 版本与安全

- 握手：页面加载后 `bridge.hello` 交换 `{protocolVersion, appVersion, locale, capabilities}`，不匹配即红屏提示重装/升级。
- 安全：`SetVirtualHostNameToFolderMapping` 加载本地资产（避免 file:// CORS）；`WebResourceRequested` 白名单；release 构建 `AreDevToolsEnabled=false`、禁 `NavigateToString`；host object 仅一个 `Invoke` 入口，参数校验在 Adapter 层。

## 四、前端技术选型

| 项 | 选择 | 理由 | 备选 |
|---|---|---|---|
| 框架 | **React 18 + TypeScript** | AI 协作语料最大、组件生态最全、Playwright DX 最好——本项目由 agent 密集开发，这是硬权重 | Svelte/Solid（更小但语料少） |
| 构建 | **Vite** | 事实标准；HMR 使宿主调试不需要重启 exe | — |
| 状态 | **zustand** | 够小；ViewModel 状态经桥进来后是纯数据，不需要重状态库 | jotai |
| 列表虚拟化 | **TanStack Virtual** | 100k 提交列表直接可用 | 自写（保持现有 RowModel 分页逻辑即可） |
| 终端 | **@xterm/xterm.js** | VS Code 同款；替代自绘 TerminalCanvas + TerminalParser + TerminalInputEncoder + 自绘滚动条整条链 | 无 |
| Diff | **自研 DOM 渲染器**（复用服务端 UnifiedDiff/hunk 模型） | 验收台的核心交互（hunk 多选/批量暂存/风险批注/AI 活动标线）需要完全控制；Monaco 的 diff 是编辑器中心，定制这些成本反而高 | Monaco（仅作为 P5+ 提交消息编辑器/预览窗的可选增强） |
| 语法高亮 | **过渡期沿用服务端 runs**；P5 决策门：迁 Shiki | 现有 C# TextMate 子集已测试且随 diff 模型下发；Shiki（全量 TextMate + WASM oniguruma）是终局候选，牵动 .gpk syntax 包生态 → §12 开放问题 | — |
| 样式 | **CSS 变量 + CSS Modules**，无 UI 框架 | 设计语言全定制（design.md/IDE 风格），正是 CSS 最强项；令牌表由 C# 下发 | Radix primitives（菜单/弹窗 a11y 原语可局部引入） |
| i18n | **扩展 gen-localization.ps1 产出 JSON** 给前端 | 语言单一源仍是 Strings.tsv，两端各取所需 | i18next（前端消费 JSON 即可，不必引运行时） |

## 五、关键域设计

### 5.1 终端（最高风险项，P0 即打样）

- 会话生命周期留在 C#：`terminal.open {shell}` → 宿主建 ConPTY/WinPTY 会话（预检门控沿用 §11.10）→ 返回 `{sessionId, cols, rows}`；`terminal.write {sessionId, bytesBase64}` 直写 PTY；PTY 输出经 SharedBuffer 推给 xterm.js `write(arrayBuffer)`。
- **替代清单**（写明删什么）：TerminalCanvas（Win2D 自绘）、TerminalParser（VT 状态机）、TerminalInputEncoder（键盘编码）、自绘滚动条、闪烁光标计时器、选区/复制粘贴逻辑——全部由 xterm.js 承担；主题经 `term.options.theme` 从令牌表映射（`theme.*` 事件热更新，替代 TokenRuntime 就地改刷子的 workaround）。
- 延迟预算：键入→回显 P95 < 30ms（当前 WinUI 栈实测口径对齐；历史 bug：滚轮延迟 350ms、键入丢失、光标漂移——xterm.js + 字节直通理论上整类消除，P0 打样量化验证）。

### 5.2 Diff（验收台旗舰）

- 行/hunk/字级模型**全部来自服务端**（现有 `ParseUnifiedDiff` + DiffCanvas 的行模型逻辑下沉到 Core，已有测试护航）；前端 DiffViewer 是纯渲染层：DOM 行 + 绝对定位 hunk 覆盖层 + Ctrl+点击多选 + 批量暂存（`changes.stageHunks`）。
- 虚拟化窗口化：只渲染可视区 ±N 行（行模型服务端已分页，万级行 diff 不整块进 DOM）。
- 语法 runs、EOF 标志、trailers（会话溯源）随行模型下发。

### 5.3 主题

- 单一事实源仍是 C# `ThemeService`（.gpk 包解析/语义令牌都在那边）；启动与切换时 `theme.tokens` 全量下发 → 前端写 CSS 自定义属性 + xterm theme + diff 旁路配色。删除 ThemeDictionaries/VSM 压制/TokenRuntime 改刷子三类 workaround 的存在前提。

### 5.4 快捷键 / 命令面板 / 焦点

- 命令面板、页内快捷键纯 web 实现（CommandIds.cs 的注册表语义平移）；**系统级全局键**（若有）由宿主 accelerator 捕获后转发 `event/app.accelerator`。历史"命令面板残留抢占键盘/焦点漂移"类 bug 整类消除（web 焦点模型 + React 状态可预测）。
- 右键菜单/下拉用 Radix primitives 或自绘（a11y 内建），替代 WinUI MenuFlyout。

### 5.5 原生能力清单（留在宿主，永不下沉）

FolderPicker（SHBrowseForFolder 变通，§五.3）、SecretProtector（DPAPI）、McpPipeHost（命名管道）、AiGatewayFactory、DiffPreviewWindow（被 web 内嵌预览替代后删除）、单实例/任务栏交互、崩溃兜底日志。

## 六、迁移范围清单

| 处置 | 对象 | 说明 |
|---|---|---|
| **保留不动** | GitUI.Core / GitUI.Git / GitUI.Shell / GitUI.ViewModels；全部 headless 测试（S6 验收 449 条 + P0–P5 新增批次）；McpPipeHost / AiGatewayFactory / SecretProtector / FolderPicker | 迁移的安全垫 |
| **重写（web/）** | MainWindow、7 个 Page（≈4.9k 行）、UiKit、DiffCanvas、TerminalCanvas、PaneDivider、ThemeService 的 UI 侧（ThemeStyles.xaml 1161 行 → CSS 变量） | 约 8.7k C# + 1.4k XAML；其中相当比例是绕框架坑的防御性代码，web 侧不需要等量重写（预估 10–15k TS/CSS，但增量功能成本断崖下降） |
| **删除** | TerminalParser / TerminalInputEncoder 的 UI 消费链、自绘滚动条、VSM/ThemeDictionaries workaround、22 个 UIA PS 冒烟中的 UI 断言部分（改 Playwright） | xterm.js 与测试栈接管 |
| **新增** | `web/` 前端工程、WebBridge（宿主内 Adapter 层 + gen-bridge 类型生成）、Playwright 套件 | — |

## 七、分阶段计划（绞杀者模式，每阶段有验收门与回滚）

总原则：**dev 分支承载迁移；master 保持可发布；迁移期 WinUI 侧功能冻结**（否则双栈范围蔓延，§12 开放问题 4）。每页迁移完成前，`settings.json` 开发者开关 `ui.backend: winui | web` 决定该页走旧栈还是新栈——新页没过验收门，旧页一直可用。

| 阶段 | 内容 | 验收门（量化） | 回滚 |
|---|---|---|---|
| **P0 地基（~1 周）** | web/ 脚手架；WebView2 宿主壳（虚拟域名、桥 POC、SharedBuffer POC）；终端延迟打样；Playwright CI 跑通第一条 spec | 桥 RTT < 5ms；PTY→xterm 回显 P95 < 30ms；`build.ps1` 一条命令出 exe | 纯增量，随时弃 |
| **P1 Log 页** | 只读先行（100k 虚拟列表、日分组、详情、只读 diff）→ 右键菜单/比较操作 | 100k 首屏 < 500ms、翻页 < 200ms（继承现有预算）；smoke-log-page 场景的 Playwright 版全绿 | 开关切回 winui |
| **P2 变更页（最重）** | DiffViewer 全交互（并排/内联/字级/hunk 多选/批量暂存/EOF）、提交流、冲突最小闭环 | Changes 域 C# 测试全绿 + hunk 暂存/撤销 Playwright 场景全绿；1 万行 diff 滚动无卡顿（帧预算 16ms） | 同上 |
| **P3 终端页** | xterm.js + 会话生命周期 + 双后端预检沿用 + 选区/复制粘贴 | 键入回显 P95 < 30ms；smoke-bash-terminal / shell-switch 场景 Playwright 版全绿 | 同上 |
| **P4 分支/项目/任务页 + 命令面板 + 分割条** | CSS resize 或 pointer 自绘（分割条位置持久化语义沿用） | 各页 Playwright 冒烟全绿；splitter 拖动无抖动（历史 bug 验收点） | 同上 |
| **P5 设置页 + 主题/i18n 收口** | .gpk 语法包路线决策（§12.3）；语言热切换 | 亮暗/主题包切换全量令牌快照对比通过；i18n 双语 spec | 同上 |
| **P6 清退** | 删 WinUI 页面层与 GitUI.Controls；App 缩为宿主；打包签名；master 合并，WinUI 栈打 tag 封存 | 全量 Playwright + headless 测试绿；干净 Win11 复测（known-issues §五黑名单项在新栈复测后销账） | tag 保底 |

工期口径：按"单人 + AI agent 密集协作"估 P0–P6 约 8–12 周全职当量；P2/P3 是风险主体，允许与 P1 并行两条线推进。

## 八、测试策略（PS 脚本 → Playwright 映射）

- **不动的**：全部 C# headless 测试原样跑（这是换栈不换命的底气）；`check-uia-conventions` 类源码扫描退役。
- **重写的**：22 个 smoke/diag/verify 脚本按场景映射为 Playwright specs（`smoke-log-page.spec.ts`、`smoke-bash-terminal.spec.ts`…），收益立现：无头、可并行、不依赖中文 locale 与独占桌面、带截图/trace——正是旧栈四个结构性限制的反面。
- **新增的**：桥契约测试（gen-bridge 类型 + schema 快照）、令牌快照（主题回归）、Playwright axe 无障碍扫描（替代"无障碍扫描 S7 待办"）。
- **保留至 P6 的**：UIA 脚本在 master 冻结，护住过渡期旧栈页面。

## 九、性能预算（继承现有口径）

| 指标 | 预算 | 现栈实测基线 |
|---|---|---|
| 100k 提交 Log 首屏 | < 500ms | Debug 123ms（web 侧目标同级） |
| Log 翻页 | < 200ms | 120ms |
| 终端键入回显 | P95 < 30ms | 新指标（P0 打样定基线） |
| 冷启动到可交互 | ≤ 现栈 +300ms | WebView2 初始化开销，P0 实测 |
| 常驻内存 | 现栈 +150~250MB | Chromium 固有成本，明码标价 |

## 十、风险与缓解

1. **SharedBuffer 依赖 WebView2 runtime 版本** → 降级 base64 分块路径常备，P0 实测后定阈值。
2. **焦点/IME 跨缝**（web 与宿主两级窗口）→ 原生对话框调用期间宿主持有焦点；键入类全局键只在终端页存在且纯 web 处理。
3. **超大 diff/日志内存** → 虚拟化 + 服务端分页是既有架构，前端不引入整块加载。
4. **WebView2 runtime 缺失**（LTSC/离线机）→ 启动检测 + 引导装 evergreen；企业场景提供固定版本分发选项（体积代价写进发布说明）。
5. **双栈过渡期设置/主题状态两套** → 令牌与设置的单源仍在 C#，旧栈只读消费，无双写。
6. **迁移期范围蔓延** → WinUI 侧功能冻结写进分支纪律（§12.4 需拍板）。
7. **Playwright 对 WebView2 的驱动** → 用 Playwright 驱动 Chromium CDP 连 WebView2（`--remote-debugging-port`，仅 debug 构建开启）；release 签名构建不受影响。

## 十一、迁移期目录形态（终态）

```
src/
  GitUI.App/            瘦宿主：WebView2 + WebBridge Adapters + 平台服务
  GitUI.Core/           不变（+ diff 行模型从 Controls 下沉）
  GitUI.Git/            不变
  GitUI.Shell/          保留 ITerminalSession/ConPTY/WinPTY（Parser/Encoder 随 P3 删）
  GitUI.ViewModels/     不变
web/                    前端工程（TS/React/Vite/Playwright）
  src/app/              壳、导航、命令面板
  src/pages/            七页
  src/components/       DiffViewer / VirtualList / TerminalPane / ...
  src/bridge/           gen-bridge 生成的类型 + 客户端
  src/themes/           令牌 CSS 消费层
scripts/gen-bridge.ps1  C# DTO → TS 类型
```

## 十二、开放问题（动工前需拍板）

1. **终局栈确认**：本方案推荐 WebView2 混合（§一）。若未来要跨平台（macOS/Linux），再评估 Tauri + sidecar，桥协议设计已按"传输无关"预留。
2. **前端框架**：推荐 React；若在意包体与运行时性能可选 Svelte——需在 P0 前定死，中途换框等于二次迁移。
3. **语法高亮终局**：服务端 runs（现状平移，.gpk syntax 生态不动）vs 前端 Shiki（全量 TextMate，但 .gpk 语法包需迁移映射）。P5 决策门，不阻塞前面阶段。
4. **WinUI 侧冻结范围**：建议"修致命 bug、冻结新功能"；若有必须并行交付的产品功能，需单列。
5. **Monico 取舍**：是否引入 Monaco 作为提交消息编辑器与代码预览窗（约 +5MB 包体）。默认不引入，textarea + 服务端 runs 起步。

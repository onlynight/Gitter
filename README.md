# Git UI 工具设计方案（WinUI 3 / .NET）

> 状态：定稿 v1.0
> 日期：2026-10-02

---

## 一、产品定位与范围

**一句话定位**：面向 Windows 上开发者的高性能本地 Git 客户端 —— 图形化查看提交历史、变更差异、进行提交与合并，做到"打开即用、无需记命令"。

**目标用户**：日常用命令行 git 但不想记参数、需要频繁看历史/diff、需要可视化解决冲突的中级及以上开发者。

**明确不做（v1）**：PR/Review 协作、CI/CD 集成、远程仓库账号托管（GitHub/GitLab UI）、多仓库批量操作、源代码管理服务器同步。这些是 GitKraken/SourceTree 的重资产部分，会稀释核心体验。

**核心理念（借鉴来源）**：

| 借鉴对象 | 吸收什么 |
|---|---|
| JetBrains IDEA/PyCharm | 底部 Git 工具窗口结构：Log / Changes / Branches / Repo Map 五页签；Log 中按作者/分支/日期过滤并分组；Repo Map 可视化分支拓扑；提交对话框的多 stage 模型（Changes / Staged for Commit / Unversioned） |
| VSCode | 极简的 Source Control 侧栏心智模型；diff editor 的并排/内联切换；命令面板（Ctrl+Shift+P）；状态栏当前分支指示 |
| Sublime Merge | **Log 视图的极简信息密度**：时间轴 + 作者 + 分支标签 + 提交信息一行读完；点击文件即看 diff，双击打开编辑器；键盘驱动的工作流 |

---

## 二、参考对象的可复用模式分析

### 2.1 Sublime Merge 的 Log 视图（本工具的核心）

单栏列表，每行固定列宽：

```
[提交时间] [相对时间] [分支标签] [作者] [提交标题]
[缩略diff统计]
```

关键点：默认只显示"当前分支可达"的提交，形成一条干净的时间轴；按天/星期/月折叠分组；提交信息可编辑、可搜索（搜索是过滤而非跳转）；点文件行 → diff 内联展开 → 再点 → 用默认编辑器打开。

**我们的取舍**：保留单栏极简，但支持多行模式（增加 SHA/变更文件数统计）；保留分组折叠；搜索采用"过滤 + 高亮"。

### 2.2 IDEA 的 Git 工具窗口

- 五页签：Log / Branches / Uncommitted Changes / Stashes / Repo Map
- Log 支持：过滤面板（提交人、日期区间、关键词）、按提交信息分组、比较任意两个提交的 diff、右键菜单极丰富
- Uncommitted 分三层：Changes（已跟踪未提交）/ Staged（已 add）/ Unversioned（未跟踪）

**我们的取舍**：完整实现三层 stage 模型（这是 IntelliJ 系最值得借鉴的设计，git 命令行天然区分，UI 必须显式呈现）；Branches 页签用树 + Repo Map 双视图。

### 2.3 VSCode 的交互范式

- 状态栏左下角：当前分支 + 变更数，点击展开侧栏
- Ctrl+Shift+P 命令面板作为"所有操作的兜底入口"
- Diff 并排/内联一键切换，行内"接受"按钮解决冲突

**我们的取舍**：命令面板必备（降低菜单层级记忆成本）；diff 编辑器必须支持并排/内联切换。

---

## 三、整体架构

### 3.1 技术栈（已锁定）

| 层 | 选型 | 理由 |
|---|---|---|
| UI 框架 | WinUI 3 + .NET 9，MVVM（CommunityToolkit.Mvvm） | 目标平台 Win11 原生控件；WinAppSDK 提供 `NavigationView`、`TreeView` 等现成控件 |
| Git 操作 | **libgit2sharp（主）+ git CLI（兜底）** | 无子进程开销、纯内存操作、支持 blob/tree/commit 直接读取，大 log 查询快；merge/rebase/cherry-pick 等 libgit2 支持薄弱场景走 CLI |
| Diff 引擎 | Myers + `DiffPkg`（Microsoft 内部 diff 库，GitHub/VSCode 同款） | 与 VSCode 的 diff 算法一致，性能优秀 |
| Diff 渲染 | **自绘 `DiffCanvas`（`DrawingContext`）** | 完全控制行对齐、字级高亮、滚动性能；这是与竞品的核心体验差异点 |
| 状态管理 | 仓库级 `RepositorySession` + 全局 `Settings` | 见 §5 数据流 |
| 发布 | **自包含 exe，单目录**（self-contained） | 无沙箱限制，可直接读写任意路径与系统 git 凭据 |

### 3.2 进程与线程模型

```
UI 线程 (DispatcherQueue)
   └─ 唯一可改 UI 状态
主操作线程 ── GitWorker：BlockingCollection<GitRequest>，1 worker
   └─ 执行 libgit2 调用；结果经 TaskScheduler.FromTaskScheduler / dispatcher 回投
```

**关键约束**：libgit2 的 `Repository` 句柄**不可跨线程**。因此 `GitRequest` 是纯数据指令（`{ Action, Args }`），每个请求在 worker 线程内打开 repo、用完即弃，配合 `Lazy` 缓存。这解决了并发查询与 UI 冻结的冲突。

### 3.3 分层

```
┌─ UI Layer：XAML Pages + Controls（LogPage, DiffView, BranchesPage...）
├─ ViewModel：LogViewModel, ChangesViewModel, CommitViewModel（可测试，无 UI 依赖）
├─ Domain：GitModel（CommitNode, DiffHunk, TreeEntry, BranchRef）── 不可变记录类型
├─ RepositoryService：把 GitModel 映射到 libgit2sharp 调用
└─ Infrastructure：SettingsStore, EditorLauncher, EncodingSniffer, LargeFileFilter
```

---

## 四、界面布局设计

### 4.1 窗口主布局

```
┌──────────────────────────────────────────────────────────┐
│ TitleBar: [仓库名·分支▾] 搜索框(⌘K)        ⋯             │
├────────────┬─────────────────────────────────────────────┤
│ NavView    │  主内容区（按页签切换）                       │
│ ┌────────┐ │ ┌─ Log / Changes / Branches / Settings ────┐│
│ │ Log    │ │ │                                           ││
│ │ 变更   │ │ │                                           ││
│ │ 分支   │ │ │                                           ││
│ │ ⋯设置  │ │ │                                           ││
│ └────────┘ │ └───────────────────────────────────────────┘│
├────────────┴─────────────────────────────────────────────┤
│ 状态栏: main* (+3 -12) │ 2 uncommitted │ ⌘K │ git 版本    │
└──────────────────────────────────────────────────────────┘
```

- **可停靠多面板**：主区支持左右分屏（左 Log / 右 Diff），实现方式为自定义 `Grid` + 拖拽 `GridSplitter`，v1 不做完整 DockingManager。
- 所有窗口支持 Win11 的 Mica 背景与自定义 title bar，实现细节见 §4.1.1。

### 4.1.1 窗口背景与标题栏（WinUI 3 Mica 实现）

> 参考实现：`ECHWorkers.WinUI3`（`MainWindow.xaml` / `MainWindow.xaml.cs`）。本项目的模糊背景、标题栏配色、高 DPI 尺寸限制三项能力直接沿用其方案。

**四项构成**：

1. **Mica 背景**（Windows 11 桌面合成器特性）

   ```csharp
   private void ConfigureBackdrop()
   {
       try { this.SystemBackdrop = new MicaBackdrop(); }
       catch { /* 无桌面合成器时回退为普通窗口 */ }
   }
   ```

   `MicaBackdrop` 必须用 `try/catch` 包住 —— 在 Windows 10、部分虚拟机、无桌面合成的会话中会抛异常，此时窗口退化为纯色背景，不影响功能。这是必须做的兜底，不能省略。

2. **标题栏与内容合并**

   ```csharp
   this.SetTitleBar(TitleBarStrip);            // TitleBarStrip 是高度 48、背景透明的 Border
   this.ExtendsContentIntoTitleBar = true;
   this.AppWindow.TitleBar.ExtendsContentIntoTitleBar = true;
   ```

   根 `Grid` 必须设 `Background="Transparent"`，否则 Mica 被不透明背景盖住。标题栏区域本身不绘制内容，只作为 `SetTitleBar` 的拖拽热区；应用名/仓库名/搜索框作为独立 `Border`/`TextBlock` 叠加在 `RootGrid` 上。

3. **标题栏配色**（`AppWindow.TitleBar`）

   标题栏**背景必须设为透明**，min/max/close 三个按钮背景也要透明，否则按钮会挡成实心块，破坏 Mica 的整体感。文字与按钮 hover/pressed 色根据 `Application.Current.RequestedTheme` 分主题生成：

   ```csharp
   var isLight = Application.Current?.RequestedTheme == ApplicationTheme.Light;
   var text = isLight ? Color.FromArgb(0xF2, 0x1C, 0x1B, 0x1F)
                      : Color.FromArgb(0xFF, 0xFA, 0xFA, 0xFB);
   var hover = isLight ? Color.FromArgb(0x14, 0, 0, 0)
                       : Color.FromArgb(0x20, 0xFF, 0xFF, 0xFF);

   titleBar.BackgroundColor = Color.FromArgb(0, 0, 0, 0);
   titleBar.ForegroundColor = text;
   titleBar.ButtonBackgroundColor = Color.FromArgb(0, 0, 0, 0);
   titleBar.ButtonForegroundColor = text;
   titleBar.ButtonHoverBackgroundColor = hover;
   titleBar.ButtonPressedBackgroundColor = pressed;
   ```

   必须在 `ActualThemeChanged` 事件里重新调用，否则深色/浅色切换后标题栏配色不刷新。

4. **高 DPI 尺寸与最小尺寸限制**

   `AppWindow.Resize` 设置的是**逻辑像素**，在 Win32 层面实际尺寸常常不跟随，高 DPI 下尤为明显。方案是用两条路兜底：

   - `GWL_MINTRACKSIZE = -0x000C` 写入最小尺寸，**按物理像素**计算（`width * dpi / 96`）
   - 链式 `WndProc` 拦截 `WM_GETMINMAXINFO`，只处理这一条消息，其余原样 `CallWindowProc` 转发给原 WndProc

   链式转发的关键：**不能替换掉原 WndProc 而不转发**，否则 WinUI 3 自绘标题栏的命中测试会坏掉（min/max/close 点不动、标题栏拖不动）。这是最容易踩的坑。

   ```csharp
   private static IntPtr WndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
   {
       if (msg == WM_GETMINMAXINFO)
       {
           var info = Marshal.PtrToStructure<MinMaxInfo>(lParam);
           info.PtMinTrackSize = _minTrackPhys;
           Marshal.StructureToPtr(info, lParam, true);
           return IntPtr.Zero;
       }
       return CallWindowProc(_prevWndProc, hWnd, msg, wParam, lParam);
   }
   ```

   尺寸与最小尺寸的物理像素换算、`SetWindowPos` 居中都在 `Window.Activated` 首次触发时执行一次（`this.Activated -= OnWindowActivated` 保证只跑一次）。

**侧边栏导航项视觉**（配套 Mica 使用）：

因为 Mica 底色是动态的（跟随桌面壁纸），侧边栏选中/hover 色不能用固定主题色，必须按主题生成半透明叠加层：

```csharp
private SolidColorBrush SelectedBrush =>
    Application.Current?.RequestedTheme == ApplicationTheme.Light
        ? new SolidColorBrush(Color.FromArgb(0x33, 0x1C, 0x1B, 0x1F))  // 亮色：18% 深灰
        : new SolidColorBrush(Color.FromArgb(0x33, 0xFF, 0xFF, 0xFF));  // 暗色：20% 白
private SolidColorBrush HoverBrush =>
    Application.Current?.RequestedTheme == ApplicationTheme.Light
        ? new SolidColorBrush(Color.FromArgb(0x1A, 0x1C, 0x1B, 0x1F))
        : new SolidColorBrush(Color.FromArgb(0x1A, 0xFF, 0xFF, 0xFF));
```

未选中项背景 `ClearBrush`（完全透明），让 Mica 直接透出。未选中项 `Opacity = 0.8`，选中/hover 为 `1.0`，用不透明度差区分状态而不是加边框，视觉上更贴合 Win11 原生应用。

**本项目落地差异**：

| 项 | 参考项目 | 本项目 |
|---|---|---|
| 侧边栏 | 固定 200px 宽，永不收起 | 固定宽度，`NavigationView` 替代手写的 Button 列表 |
| 标题栏内容 | 仅应用名"ECH Workers" | 仓库名 + 当前分支 + 变更数 + 全局搜索框 |
| 最小尺寸 | 1056 × 695 | 900 × 600（Git 工具信息密度更低，可缩小） |
| 主题响应 | `ActualThemeChanged` 重新着色 | 同上，另加 `SettingsStore` 的 `ThemePreference` 联动 |

**可验证点**（对应 S0 阶段验收）：

- Win11 上窗口有 Mica 动态底色（换桌面壁纸后窗口底色随之变化）
- 主题切换后标题栏文字与按钮 hover 色正确刷新
- 150% / 200% 缩放下窗口尺寸与最小尺寸符合预期，标题栏拖拽和 min/max/close 可点击
- 在无桌面合成器的会话中启动不崩溃，退化为纯色背景

### 4.2 Log 页（核心页，占开发量 40%）

```
[工具条] 刷新 ▾过滤 │ 分支: [main ▾] │ 作者: [全部] │ ⤴比较  ⋯更多
[时间轴列] [信息列]                            [右侧 diff 预览]
●  a3f9c2  昨天  main        alice  feat: add log filter      [文件列表]
   ├── ● b71d44  昨天        bob    fix: null deref           [统一diff]
   │    ├── ● c5e830  前天   alice  refactor                 │
   └── ● d201ef  3天前       carol  chore: bump deps         │
```

**功能清单（按优先级）**：

| P0 | 功能 | 说明 |
|---|---|---|
| P0 | 单分支时间轴 | 默认只显示 `HEAD` 可达提交，节点用相对位置画出父子缩进线 |
| P0 | 点击提交 → 右侧显示变更文件列表 + 点文件显示 diff | Sublime Merge 同款交互 |
| P0 | 搜索过滤 | 支持 `author:` `branch:` `after:` `before:` `topic:`（git log 语义） |
| P0 | 分组折叠 | 按天分组，标题显示相对时间，可展开/折叠 |
| P1 | 多分支并排 | 选择 2+ 分支后合并成有合并线的树（`git log --all`），节点着色区分分支 |
| P1 | Commit Graph 视图切换 | 列表模式 ↔ 图模式（图模式用 Canvas 画连线） |
| P1 | 任意两点比较 | 右键 → Compare with selected，进入三方 diff（HEAD / A / B） |
| P2 | Repo Map（IDEA） | SVG/Canvas 画分支拓扑，支持拖动创建/删除分支（**v2**） |
| P2 | 提交消息模板/引用 | 右键 → Cherry-pick / Revert / Tag here |

**性能目标**：10 万提交的仓库，首屏 50 条 < 500ms，滚动加载下一页 < 200ms。
实现手段：`git rev-list --topo-order` 流式分页读取；虚拟列表用 `ItemsRepeater`（比 `ListView` 更适合高密度）；提交信息预解析为结构化缓存。

### 4.3 Changes 页（未提交变更）

三层列表 + 底部操作栏（IDEA 模型）：

```
Changes (已跟踪, 有改动)      [−] [⊕]
  ├─ src/Main.cpp       M   +42 −17
  ├─ src/Util.cs        M   +3  −1
Staged for Commit          [⊖ 全部撤销]
  ├─ src/App.xaml       A   +120
Unversioned (未跟踪)       [⊕] [⚙ 加入.gitignore]
  ├─ notes.txt          U
─────────────────────────────────
备注: [________________]  [提交] [提交并推送]
```

- 每行右侧显示 diff 统计（+绿 −红）
- 单文件点击 → 打开 diff；**勾选框**勾选后点提交按钮（IDEA 风格，避免"先 add 再 commit"两步）
- Diff 编辑器内支持"选中行暂存"（stage hunk），这是 IDEA/Sublime Merge 都有的杀手功能
- 提供 `Commit` 与 `Commit & Push`；push 失败时给出具体原因与"重试/取消"

### 4.4 Diff 编辑器（独立核心组件）

| 能力 | 实现 |
|---|---|
| 并排 / 内联切换 | 自绘 `DiffCanvas`（`DrawingContext`） |
| 差异着色 | 新增行浅绿、删除行浅红、变更行内高亮字级差异 |
| 行级操作 | 冲突时显示 Accept Current / Accept Incoming / Accept Both |
| 跳转到下一个/上一个变更 | Alt+↑/↓（VSCode 同款快捷键） |
| 语言高亮 | v1 用简单正则高亮，支持 C#/C++/JS/JSON/MD |
| 大文件保护 | > 5MB 或 > 20k 行提示"以默认编辑器打开"，不落 diff 视图 |
| 二进制文件 | 显示"二进制文件已修改，无法比较" + 打开文件/丢弃按钮 |
| 编码 | 自动探测 UTF-8/GBK/Latin1，可手动覆盖（`EncodingSniffer`） |

**组件决策**：WinUI 3 目前没有成熟的语法高亮 diff 控件，**自绘 `DiffCanvas` 是必须自建的部分**，估计 4000–6000 行代码。这是全项目最大的技术风险点。

### 4.5 Branches 页

- 树视图：Local / Remote 分组，显示 `[name] (sha) - message`
- 操作：Create / Rename / Delete / Checkout / Merge / Rebase / Fast-forward
- 顶部三个按钮：**Pull / Pull Rebase / Push**（IDEA 同款，明确区分 merge 与 rebase）
- 远程跟踪分支可右键 Fetch / Reset to / Compare

### 4.6 命令面板（Ctrl+Shift+P）

- Fuzzy 搜索所有命令，按使用频率排序
- 支持参数化命令（`git commit (with message)…`）
- 实现：自定义 `AutoSuggestBox` + 命令注册表（`[Command("git.commit")]` 属性标记）

---

## 五、数据流与状态管理

### 5.1 状态分层

```
SettingsStore        ← 全局设置（主题、默认编辑器、diff 模式），JSON 持久化
RepoSession          ← 仓库级状态，每开一个仓库一个实例
 ├─ IndexState       ← git status 结果，监听文件变化刷新
 ├─ LogState         ← rev-list 分页缓存 + 过滤条件
 ├─ DiffState        ← 当前打开的 diff 目标
 └─ WorkingTreeWatcher ← 文件监视器（FileSystemWatcher）
```

- 单例 `IRepositoryService`，注入 `IWorker` 队列
- ViewModel 只订阅 `IObservable<RepoSession>` 的粗粒度变更，内部再细粒度更新（避免全量刷新 UI）

### 5.2 变更检测

| 来源 | 机制 | 频率 |
|---|---|---|
| 外部工具改文件 | `FileSystemWatcher`（仅监视 tracked 文件的父目录） | 实时，500ms 去抖 |
| 外部 git 命令 | 对比 `HEAD` SHA + `git status` 哈希 | 焦点回窗口时 + 每 30s |
| 大仓库性能 | 忽略 `.git` 自身、node_modules、binaries | — |

### 5.3 错误与空状态

- 每个列表有明确的空状态插画 + 引导文案（如 Changes 空 → "没有未提交的变更" + 一个"刷新"按钮）
- Git 操作失败统一显示在顶部 toast（含 stdout/stderr 前 5 行 + "复制完整输出"）
- 网络失败（fetch/push）明确区分"认证失败 / 网络超时 / 分支冲突"三类，给出对应下一步建议

---

## 六、关键交互细节（易用性设计）

1. **首次启动引导**：3 步 —— 选择仓库目录（记住最近 5 个）→ 信任证书（提示是否使用系统凭据管理器）→ 选择默认外部编辑器
2. **快捷键**（保持肌肉记忆迁移）：
   - `Ctrl+Enter` 提交（焦点在任何位置都有效）
   - `Ctrl+Shift+P` 命令面板
   - `Alt+↑/↓` 下一个/上一个 diff 变更
   - `Ctrl+D` 当前文件 diff
   - `Ctrl+Tab` 循环切换页签
   - `F5` 刷新所有
   - `Ctrl+1..4` 直达页签
3. **右键菜单分层**：常用 6 个直接列出，其余进 "⋯ 更多"，避免一次展开 20 项
4. **可撤销**：所有危险操作（删分支、reset、rebase）弹确认框且显示具体影响范围（"将丢弃 3 个提交：a3f9c2, b71d44, c5e830"）；`reset` 默认 `--soft` 并明确提示
5. **提交消息助手**：
   - 自动从文件名生成 conventional commit 前缀（`feat:`/`fix:`）
   - 显示被提交文件列表预览（IDEA 同款，防止误提交）
   - 最近 20 条提交消息作为模板建议
6. **深色/浅色/跟随系统**：WinUI 3 `ElementTheme` 全局切换
7. **多窗口**：支持每个仓库一个窗口（窗口标题带仓库名），任务栏可区分
8. **无障碍**：所有列表项带 `AutomationProperties.Name`，diff 视图中差异块可读为"新增 3 行"

---

## 七、目录结构

```
GitUI/
├─ src/
│  ├─ GitUI.App/               # WinUI3 宿主，App.xaml.cs, MainWindow
│  ├─ GitUI.Core/              # 领域模型 + 服务接口（无 UI 依赖，可单测）
│  │   ├─ Models/              # CommitNode, DiffHunk, TreeEntry, BranchRef
│  │   └─ Services/            # IRepositoryService, ISettingsStore, IEditorLauncher
│  ├─ GitUI.Git/               # libgit2sharp 实现 + 队列 worker
│  ├─ GitUI.Diff/              # Diff 引擎与自绘控件
│  ├─ GitUI.ViewModels/        # 所有 ViewModel（CommunityToolkit.Mvvm）
│  └─ GitUI.Controls/          # 可复用控件（LogListItem, DiffCanvas, BranchTree）
├─ tests/
│  ├─ GitUI.Core.Tests/
│  ├─ GitUI.Git.Tests/         # 用临时 repo fixture 做集成测试
│  └─ GitUI.Diff.Tests/        # diff 算法单测（黄金用例）
└─ docs/
```

- 每个 `git init` 的 fixture 仓库在测试中动态生成（`git commit-tree` 手工构造特定拓扑），避免依赖真实历史

---

## 八、开发阶段划分（可独立验证）

> 划分原则：每个阶段结束时，存在一个**可运行的产物**和一个**可自动执行的验证手段**，两者都不依赖后续阶段。前一阶段的验证失败时，后续阶段不启动。

### S0 · 工程骨架与验证基线

**范围**：3 个 csproj（App / Core / Git）+ WinUI 3 空壳窗口 + NavView 四页签（Log / Changes / Branches / Settings）+ 主题切换 + 设置 JSON 持久化。

**可独立验证**：
- `dotnet build` 零警告通过
- 启动后能切页签、切主题，重启后主题设置保留
- 单元测试：`SettingsStore` 的读写与损坏文件回退（≥ 5 个用例）

**通过标准**：空壳能稳定运行 10 分钟不崩溃，`dotnet test` 全绿。

### S1 · 领域模型与 Git 读取层（无 UI）

**范围**：`CommitNode` / `DiffHunk` / `TreeEntry` / `BranchRef` 不可变模型；`IRepositoryService` 接口；libgit2sharp 实现；`GitWorker` 队列（`BlockingCollection`，1 worker，请求数据化）；`GitFixtureBuilder` 测试工具（用 `git commit-tree` 构造含分支、合并、cherry-pick 的拓扑）。

**可独立验证**：
- 纯控制台/测试工程驱动，无 UI
- 集成测试：给定 fixture repo，验证 rev-list 分页正确性、父子关系、merge 节点识别、`git status` 三层分类（Changes / Staged / Unversioned）
- 并发测试：100 个请求并发入队，无死锁、无跨线程句柄访问崩溃
- 性能基准：1 万提交 fixture 上，首屏 50 条 < 500ms

**通过标准**：所有集成测试在随机生成的 20 个不同拓扑 fixture 上全绿。

### S2 · Diff 引擎（无渲染）

**范围**：`IDiffEngine` 接口 + Myers 实现（基于 `DiffPkg`）；输出 `DiffHunk[]`；字级差异计算；编码探测（UTF-8/GBK/Latin1）；大文件与二进制判定。

**可独立验证**：
- 纯算法单测，无 UI、无 git 依赖
- 黄金用例集（≥ 30 个）：纯新增、纯删除、跨块移动、整文件替换、空文件、CRLF vs LF、GBK 中文、超长单行、二进制判定、20k 行性能
- 与 `diff -u` 输出对比（在 CI 中作为 oracle，允许块划分不同但内容等价）

**通过标准**：黄金用例全绿；20k 行文件的 diff 计算 < 300ms。

### S3 · DiffCanvas 渲染（技术风险验证）

**范围**：自绘 `DiffCanvas`（`DrawingContext`）；行高 18px 固定栅格；只绘可视区域 + 上下 overscan 20 行；并排 / 内联两种模式；行号列；差异行着色；Alt+↑/↓ 变更跳转；字级高亮。

**可独立验证**：
- 独立的 **Headless 渲染测试工程**：用 `DiffEngine` 输出喂给离屏 `DrawingContext`，断言"第 N 行绘制了哪些颜色块"（截图对比 + 几何断言）
- 独立的 **性能基准**：10k 行 diff 下滚动帧率 ≥ 30fps（用动画模拟滚动）
- 手动验证清单：10 个真实仓库的 20 个真实 diff，行对齐无人眼可见错位

**通过标准**：10k 行 diff 首帧渲染 < 200ms；滚动无掉帧；行对齐视觉检查通过。

> **关键决策点**：如果 S3 性能不达标，在此阶段切换到 RichEditBox 双层方案，而不是带着性能债继续往后做。这是全项目唯一的架构回退点。

### S4 · Log 页

**范围**：NavView 的 Log 页签接线；`ItemsRepeater` 虚拟列表；单分支时间轴（父子缩进线）；按天分组折叠；搜索过滤（`author:` `branch:` `after:` `before:` `topic:`）；点击提交 → 右侧文件列表 → 点击文件 → 复用 S3 的 DiffCanvas。

**可独立验证**：
- 集成测试：在 S1 的 fixture 仓库上跑，断言过滤结果、分组边界、分页加载数量
- UI 自动化测试（WinAppDriver / UI Automation）：断言首屏条目数、搜索后条目数、分组折叠状态
- 性能基准：10 万提交仓库，首屏 50 条 < 500ms，滚动加载下一页 < 200ms

**通过标准**：性能基准达标；UI 自动化测试覆盖"搜索 → 分组 → 点击 → 显示 diff"完整链路。

### S5 · Changes 页与提交流

**范围**：三层列表（Changes / Staged / Unversioned）；勾选框 + 提交按钮；hunk 级暂存（复用 S3 的 DiffCanvas，加行选择）；提交对话框（消息 + 文件预览 + conventional commit 前缀建议）；`Commit` / `Commit & Push`；CLI 兜底（merge/rebase/cherry-pick）。

**可独立验证**：
- 集成测试：在 fixture 仓库上执行"勾选 2 文件 → 提交 → 断言 index 与 HEAD"；"hunk 暂存 → 提交 → 断言只包含该 hunk"
- 幂等性测试：重复点击提交按钮不产生重复提交
- 失败路径测试：注入失败的 push，断言 toast 分类正确、可重试

**通过标准**：从"修改工作区文件"到"提交并 push"的端到端流程在测试仓库上可自动重放且状态断言全绿。

### S6 · Branches 页与危险操作确认

**范围**：分支树（Local / Remote）；Create / Rename / Delete / Checkout / Merge / Rebase / Fast-forward；Pull / Pull Rebase / Push 三个顶部按钮；危险操作的二次确认（显示具体影响范围）。

**可独立验证**：
- 集成测试：checkout 后断言 HEAD 移动；delete 后断言 ref 消失；rebase 后断言提交线性化
- 确认对话框测试：断言"将丢弃 N 个提交"文案与实际 N 值一致（防误操作的核心保障）
- 回滚测试：删除分支后 `reflog` 可恢复

**通过标准**：所有分支操作在 fixture 仓库上可断言终态；危险操作的确认文案数值与实际操作对象完全一致。

### S7 · 打磨与发布

**范围**：命令面板（Ctrl+Shift+P，命令注册表 + fuzzy 搜索）；全局快捷键绑定；空状态文案与插画；错误 toast 统一；多窗口（每仓库一窗口）；无障碍属性；settings 导入导出；自包含 exe 打包与签名。

**可独立验证**：
- 命令面板测试：断言 fuzzy 搜索排序、命令执行后状态变化
- 无障碍扫描：AutomationProperties 覆盖率 100%（脚本检查所有交互元素）
- 发布验证：在干净 Windows 11 虚拟机上安装并跑通 S4–S6 的完整冒烟脚本

**通过标准**：干净环境冒烟脚本全绿；无障碍扫描零缺失。

### 阶段依赖图

```
S0 ──┬── S1 ──┬── S4 ──┬── S5 ── S6 ── S7
     │        │        │
     │        └── S2 ── S3 ┘        （S2/S3 与 S1 并行，S3 完成后 S4/S5 共用）
```

- **可并行**：S1 与 S2 无依赖，可由两人并行；S3 依赖 S2
- **阻塞点**：S3 是 S4/S5 的共同前置（都复用 DiffCanvas）；S3 失败时走 §S3 的回退决策，不影响 S1/S2
- **回退成本**：S3 回退只影响自身与后续接入方式，不影响 S1/S2 的模型与引擎

---

## 九、技术风险清单

| 风险 | 影响 | 缓解 | 验证阶段 |
|---|---|---|---|
| 自绘 DiffCanvas 性能不足（大文件卡顿） | 高 | M0 就写 benchmark；只绘可视区域 + overscan 20 行 | S3 |
| libgit2sharp 对 merge/rebase 支持薄弱 | 中 | 这些操作直接 shell 调用 git CLI | S5 |
| WinUI 3 控件缺陷（`ItemsRepeater` 排序、`TreeView` 卡顿） | 中 | 关键控件准备 Plan B（自绘 `Canvas` + `VirtualizingStackPanel`） | S4 |
| 中文/日文路径与编码 | 中 | `core.quotepath=false` 自动设置 | S2 |
| 大仓库（> 1GB .git）内存 | 中 | 强制分页 rev-list，`GitObject` 用完立即释放 | S1 |
| libgit2 `Repository` 句柄跨线程访问崩溃 | 高 | `GitRequest` 纯数据化，worker 内开合 repo | S1 |

---

## 十、已确认的决策记录

| 项 | 决策 | 确认日期 |
|---|---|---|
| Git 引擎 | libgit2sharp 为主 + git CLI 兜底 | 2026-10-02 |
| Diff 视图 | 自绘 DiffCanvas | 2026-10-02 |
| 发布形态 | 自包含 exe，单目录 | 2026-10-02 |
| Repo Map | v2 再做，v1 用分支树覆盖 80% 需求 | 2026-10-02 |

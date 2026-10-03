# Git UI 工具设计方案（WinUI 3 / .NET）

> 状态：定稿 v1.5（2026-10-03 Git Bash 承载位置变更：右侧面板 → 左侧导航页签，见 §11.12）
> 日期：2026-10-03
> S0 与 S1 已实现（2026-10-02），验证详见 §11；S0b/S0c/S0d 已实现（2026-10-02），验证详见 §11.10；S2 已实现（2026-10-02），验证详见 §11.11；S3 已实现（2026-10-03），验证详见 §11.13；S4 已实现（2026-10-03），验证详见 §11.14；S5 已实现（2026-10-03），验证详见 §11.15；S6 已实现（2026-10-03），验证详见 §11.16；S7 已实现（2026-10-03），验证详见 §11.17；通用 git diff（任意两点比较，§4.2 P1 基础版）已随 S7 补充实现

## 十一、S0 实施记录与踩坑总结

S0 阶段实际开发中遇到并解决的 WinUI 3 陷阱，后续阶段开发前必读：

### 11.1 `MicaBackdrop` 的正确命名空间

`MicaBackdrop` 在 `Microsoft.UI.Xaml.Media` 命名空间下，**不是** `Microsoft.UI.Composition`。

```csharp
using Microsoft.UI.Xaml.Media;   // 正确
// using Microsoft.UI.Composition;  // 错误：编译期找不到

this.SystemBackdrop = new MicaBackdrop();
```

如果命名空间写错，编译期不报错（因为隐式引用了别的位置的 MicaBackdrop），运行时会以 `STATUS_STACK_BUFFER_OVERRUN (0xc000027b)` 崩溃在 `Microsoft.UI.Xaml.dll`，异常代码和位置完全指向 XAML 加载失败，极易误判为 XAML 语法问题。

### 11.2 `Button.Padding` 不能直接设

WinUI 3 的 `Button.Padding` 不是可直接在 XAML 属性中设置的属性（编译期报错），必须通过 Style 的 Setter，或在代码后置中赋值：

```csharp
// 代码后置：可以
var btn = new Button { Padding = new Thickness(12), ... };

// XAML：报错，不要这样写
<Button Padding="12">   <!-- error -->
```

参考项目 ECHWorkers 通过 `SidebarItemButton` 样式定义 Padding，本项目的 sidebar 按钮全部改为代码后置构建，避开 XAML 属性问题。

### 11.3 `_titleBarStrip` 不能在视觉树中出现两次（关键坑）

`this.SetTitleBar(element)` 会把传入的 element 用作标题栏拖拽热区。该 element **只能作为视觉树中的一个节点的子元素**（通常是右侧内容 Grid 的直接子元素，与 PageHost 并列）。

之前踩的坑：在 ShowPage 里往 `_pageHost` 里 `Add(_titleBarStrip)`，导致同一元素同时是 `_pageHost` 和 `rightHost` 的子元素，触发 XAML 运行时的 `0xc000027b` 崩溃。

**正确做法**（参考 ECHWorkers）：

```xml
<Grid Grid.Column="1">
    <Grid x:Name="PageHost"/>
    <Border x:Name="TitleBarStrip" Height="48" VerticalAlignment="Top" Background="Transparent"/>
</Grid>
```

两个 Grid 子元素并列，`TitleBarStrip` 只在视觉树里出现一次。切换页面时 `PageHost.Children` 全清重建，但 `TitleBarStrip` 保持不动。

### 11.4 高 DPI 最小尺寸设置暂不实现

参考项目的 `GWL_MINTRACKSIZE` + 链式 `WndProc` 方案在本项目 S0 阶段测试中触发崩溃（可能是 EnumWindows 时机问题）。S0 阶段先不做最小尺寸限制，S4 打磨阶段再加。当前窗口只设默认尺寸 1120×700，用户可自由缩小到 WinUI 3 的默认下限。

### 11.5 主题切换的正确调用时机

`Application.Current.RequestedTheme` 必须在 `Application.Current != null` 时设置。构造函数里立即调用可能为 null，需要 try/catch 或判空。主题切换后必须手动调用 `ApplyCaptionColors()` 重新设置标题栏配色，因为 `ActualThemeChanged` 事件在构造函数里还未生效。

### 11.6 S0 实际交付清单

- 3 个 csproj（App / Core / Git）+ 1 个测试项目
- App 支持 Mica 背景、自定义标题栏（透明）、四页签导航、主题切换（跟随系统/浅色/深色）、Diff 模式设置
- SettingsStore 10 个测试用例全绿（含损坏文件回退、枚举越界归一化、最近仓库去重与截断、更新事件触发）
- 完整解决方案 `dotnet build` 零警告零错误
- App 实际启动稳定运行 ≥ 10 秒

### 11.7 S0 未做（留给后续阶段）

- ~~Git 仓库读取与 Log 视图~~（S1 已完成见 §11.9；Log 页 S4 已完成见 §11.14）；~~Diff 引擎~~（S2 已完成，见 §11.11）；~~DiffCanvas 渲染~~（S3 已完成，见 §11.13；S4 复用）
- Git Bash 面板收尾（S2b TerminalParser + S3b TerminalCanvas 渲染 + S0e 与工作区联动）；S0b/S0c/S0d 已完成，见 §11.10
- ~~Changes 三层列表与提交对话框~~（S5 已完成，见 §11.15）；~~Branches 分支树与操作~~（S6 已完成，见 §11.16）
- 命令面板、快捷键、无障碍、多窗口（S7）
- 高 DPI 最小尺寸限制（S4，需重新调研 WndProc 挂钩时机）
- MSIX 打包（S7，v1 目标自包含 exe 单目录）

---


### 11.8 S0 交付补记

- 交付：`GitUI.App` 空壳（Mica + 四页签 + 折叠 sidebar）+ `GitUI.Core/Settings` + 10 用例。
- 验证：`dotnet build` 零警告；`dotnet test` 全绿；UI 冒烟 `verify.ps1` 通过。
- 踩坑细节见上文 11.1–11.5。

### 11.9 S1 实施记录（2026-10-02）

- 交付：
  - `GitUI.Core/Models`：`CommitNode` / `DiffHunk` / `DiffResult` / `TreeEntry` / `BranchRef` / `WorktreeFileStatus` / `StatusCategory` / `LogPage` / `LogFilter`（不可变）。
  - `GitUI.Core/Services`：`IRepositoryService`（全方法收路径字符串、内部开合句柄）。
  - `GitUI.Git`：`LibGit2RepositoryService` / `GitWorker`（BlockingCollection 单 worker，请求纯数据化） / `LineDiff`（S1 临时 LCS 行级 diff，S2 换 DiffPkg）/ `GitFixtureBuilder`（git CLI，隔离 HOME + 确定性时间戳）/ `RandomizedFixtureGenerator`（20 拓扑）。
  - `tests/GitUI.Git.Tests`：113 用例（见下表）。
- 验证：`scripts/verify-s1.ps1` 一键：构建零警告 → 全部测试绿 → 20 拓扑参数化 → 性能基准。
- 测试矩阵：
  | 类 | 用例 | 内容 |
  |---|---|---|
  | GitFixtureBuilderTests | 7 | builder 行为 |
  | LogTests | 21 | 分页/过滤/父子/merge 识别/边界 |
  | StatusTests | 12 | 三层分类（Changes/Staged/Unversioned） |
  | BranchAndTreeTests | 12 | 分支 isHead / 树遍历 / diff 统计 |
  | DiffHunkParsingTests | 8 | 纯增/纯删/中改/空输入 |
  | WorkerConcurrencyTests | 8 | 100 并发无死锁 / 异常传播 / Dispose 拒收 / 超时 |
  | TopologyParameterizedTests | 40 | 20 拓扑 × 2（log 回环 + status 干净） |
  | PerformanceTests | 5 | 10 提交基线 + 10k 基准 |
- 性能基准（本机实测，Debug 构建）：
  - `GetLog`（10 提交）：首次 26ms / 稳态 **5ms**
  - `GetLog(10k 提交, limit=50)`：首次 178ms / 稳态 **134ms**（阈值 500ms）
  - `GetBranches(10k)`：**21ms**；`GetStatus(10k 干净)`：**33ms**
  - fixture：`git fast-import` 单进程灌 10k 提交仅 ~450ms（对比逐条 CLI 需 ~25 分钟）
- 关键实现决策：
  1. **GetLog 两段式**：先轻量收集 `(CommitterDate, AuthorDate, Sha, Commit)` 元组（不物化 CommitNode），显式排序后只对 `Skip..Skip+Limit` 窗口做 ToCommitNode。TotalCount 由完整遍历免费得到。
  2. **branch/tag 映射预计算**：每页一次构建 `SHA → 分支名/标签名` 字典。原实现每个提交全量扫 `repo.Branches`（O(提交数×分支数)），10k 仓库下单次 GetLog 超过 500ms；预计算后降到 ~160ms。
  3. **StatusEntry.State 按位检查**：libgit2sharp 把 index 侧和 workdir 侧状态 OR 在同一字段（如 `ModifiedInIndex, ModifiedInWorkdir`），`is` 模式匹配会漏掉组合态；同一文件可同时产生 Staged + Changes 两条记录（IDEA 双层列表语义）。纯 untracked 只归 Unversioned，不重复进 Changes。
  4. **IsHead 用 `repo.Head.FriendlyName` 判定**：tip SHA 相等会把"刚创建还没 checkout"的同 SHA 分支误标为 HEAD。
- libgit2sharp 0.32.0 API 踩坑（与常见教程差异极大，全部实测确认）：
  1. `Repository.Init(path, isBare)` 返回 `string`（git 目录路径），不是 `Repository`；需再 `new Repository(gitDir)`。
  2. 无 `Repository.WorkingDirectory`，用 `repo.Info.WorkingDirectory`（带尾 `/`）；无 `repo.Status()`，用 `repo.RetrieveStatus(StatusOptions)`。
  3. `new Signature(name, email)` 不存在 —— `Signature` 构造器强制 `DateTimeOffset`。不存在的成员会被解析成类型表达式，报错信息完全误导。
  4. `RepositoryStatus` 迭代元素是 `StatusEntry`；`Tree` 无 `DirectoryEntry`，取子树用索引器 + `entry.Target as Tree` 逐级下降；`WalkTree` 拼路径要用 `entry.Name`（`entry.Path` 在子树里仍是裸名）。
  5. `TreeEntry.Mode` 是 `LibGit2Sharp.Mode` 枚举（ExecutableFile=33261 等），Core 模型用十进制常量（C# 无八进制字面量）。
  6. `FileStatus` 组合态必须按位 `&` 检查（见上 3）。
- GitFixtureBuilder 要点：
  1. `git init` 必须先于任何 `git config`（否则 "not in a git directory"）。
  2. 提交信息含空格：逐参数引号转义后拼接（`Escape()`），`-m` 拆词 / `-F -` 依赖 stdin 都有坑。
  3. 确定性时间戳用 `GIT_AUTHOR_DATE` / `GIT_COMMITTER_DATE` 环境变量（`-c author.date=x` 无效）。
  4. 同秒提交排序不稳 → GetLog 显式 `OrderByDescending(CommitterDate).ThenBy(AuthorDate).ThenBy(Sha)`。
  5. cherry-pick 测试要选"目标分支没有的提交"，避开 "already applied" / "now empty"。

### 11.10 S0b/S0c/S0d 实施记录（2026-10-02）

**交付**：

- `GitUI.Core/Settings`：`AppSettings` 新增 6 个终端字段（`ConsolePaneCollapsed` / `ConsolePaneWidth` / `BashPath` / `TerminalFontFamily` / `TerminalFontSize` / `TerminalFollowRepo`），`Normalize` 补宽度 [360,960]、字号 [8,32] 的 NaN/Infinity 兜底与空串归 null。
- `GitUI.App/MainWindow`：根 Grid 2 列改 3 列（Sidebar / Main / ConsolePane），`_titleBarStrip` ColumnSpan 2→3；ConsolePane 外壳（工具条 32px + stub 输出 + 输入行 + 状态条 20px）；自绘拖拽手柄（clamp [360,960]）；折叠三处联动（Border.Width / `_consoleColumn.Width` / `_splitter.Visibility`）；`Ctrl+J` 折叠面板、`Ctrl+Shift+J` 切换跟随仓库，均持久化；工具条 ⋯ 菜单（重开 shell / 打开 .bashrc / 跟随仓库开关 / 复制输出）。
- `GitUI.Shell`（新项目，不引用 libgit2sharp，由 `DependencyCheckTests` 自动验证）：`ITerminalSession` / `BashLocator`（三级回退，PATH 扫描等价 `where bash.exe`，引号/空格/权限异常全处理）/ `ConptyNative`（15 个 P/Invoke + 句柄计数器 `LiveHandleCount`）/ `ConptySession` / `FakeTerminalSession`。
- `tests/GitUI.Core.Tests/TerminalSettingsTests`（10 用例）+ `tests/GitUI.Shell.Tests`（28 用例，其中 ConPTY 集成 10 条覆盖 echo/pwd/ls/git status/less/exit/kill -9/resize/stdin/生命周期）。

**验证**：`dotnet build` 全解决方案零警告零错误；`dotnet test` 205 用例全绿；App 启动 22 秒稳定响应。

**踩坑**：

1. **`STARTUPINFOEX.lpAttributeList` 必须显式赋值**（关键坑）：`AllocateProcThreadAttributeList` + `UpdatePseudoConsoleAttribute` 之后若忘了 `si.lpAttributeList = _attributeList`，`CreateProcessW` 照样成功——子进程静默继承父进程控制台（输出直接打到宿主终端）、ConPTY 管道永远无输出，表现为集成测试无限挂起。无任何报错指向真相，只能靠最小对照复现定位。
2. **`DllImport` 方法改名必须同步 `EntryPoint`**：内部包装方法带 `Native` 后缀时，P/Invoke 默认按方法名找导出，运行期 `EntryPointNotFoundException`（`CreatePipeNative` 不在 kernel32 里）。
3. **`AutomationProperties.Name` 是附加属性**：不能进对象初始化器（CS0747），用 `AutomationProperties.SetName(btn, name)`。本 SDK 投影亦无 `Window.ProtectedCursor`，splitter 用 hover 背景提示替代光标形状。
4. **lambda 不能捕获 out 参数**（CS1628）：`BuildConsoleMenu(out var item)` 内部的 Click lambda 引用 `item` 报错，改成元组返回后解构。
5. **本机 ConPTY 环境损坏的识别与兜底**：本机（RDP 会话）conhost 伪终端客户端初始化整体失败——子进程秒退 `0xC0000142`、无任何输出，微软官方 ConPTY 参考实现在独立计划任务上下文中同样失败，cmd.exe 与 bash.exe 无差别；伪控制台 conhost 进程本身能启动。这不属于应用层可修复。已把集成测试改为"预检 + 软跳过"：每程序集先用 `bash -c echo` 探测 8 秒，预检跑在专用后台线程并受 15 秒看门狗保护（坏环境下 `ClosePseudoConsole` 也可能挂起，超时后放弃线程），环境不可用时输出诊断并跳过全部会话类用例，正常桌面会话中完整运行。

**S0d 剩余验证**（预检跳过的 10 条集成用例，需在 conhost 正常的桌面会话执行 `dotnet test tests/GitUI.Shell.Tests`）：echo / pwd / ls / git status / less / exit / kill -9 句柄归零 / resize 列宽回读 / stdin 写入 / 双 Start 拒绝。

> 注：S0b 交付的"右侧停靠面板"承载方式已于 2026-10-03 变更为左侧导航页签（§11.12），
> 本节保留为历史记录；其中的 ConPTY/句柄结论不受影响。

### 11.11 S2 实施记录（2026-10-02）

**交付**：

- `GitUI.Core/Services`：`IDiffEngine`（`ComputeHunks` + `ComputeWordDiff`）；`DiffText`（全项目统一的行切分语义）；`DiffOptions`（ContextLines，Normalized 截断 [0,64]）。
- `GitUI.Core/Models`：`WordSegment` / `WordSegmentKind`（字级差异分段）；`DiffHunk` 块头注释改为 git 精确语义（0 计数一侧 = 插入/删除点前一行行号）。
- `GitUI.Diff`（新项目，纯算法层，不引用 libgit2sharp / GitUI.Git，由 DependencyCheckTests 验证）：
  - `MyersDiffAlgorithm`：Myers O(ND) 线性空间分治（middle snake），intern 后整型序列 + 确定性步数预算（`StepBudget`），预算耗尽退化为整段替换（正确性不受影响）。
  - `MyersDiffEngine`（`IDiffEngine` 实现）：三层策略——① 唯一行锚点预分割（两侧各唯一且同值的行，贪心保 i/j 同序，中位锚点二分递归，git xdl/histogram 同源思路）；② 无锚点窗口走 Myers 分治；③ 预算耗尽兜底整段替换。hunk 组装直接沿 ops 取前后 ≤ context 个 Equal 作为上下文（天然对齐），相距 ≤ 2×context 的编辑块合并（git/GNU 同语义）。
  - `WordTokenizer`：ASCII 词元连跑 / 空白连跑 / 其余字符逐字符（CJK 逐字），VSCode 行内 diff 同源粒度。
  - `EncodingSniffer`：BOM → 严格 UTF-8 校验（拒绝超长/代理区）→ GBK 启发式（高位字节全成合法双字节且 ≥2 对，防 "café" 单重音字符误判）→ Latin1 兜底；`Decode` 剥 BOM。
  - `BinaryDetector`：前 8000 字节含 NUL 即二进制（git buffer_is_binary 同款）。
  - `LargeFileFilter`：>5MB 或 >20k 行（§4.4 阈值）。
  - `TextDiffPipeline`：字节级端到端管线（二进制判定 → 字节/行数上限 → 两侧各自探测解码 → 行级引擎），产出 `TextDiffResult`（含 `OldEndsWithNewline`/`NewEndsWithNewline` 标志，S3 渲染 "\ No newline" 用）。
- `GitUI.Git`：`LibGit2RepositoryService` 注入 `IDiffEngine`（默认 Myers），`ComputeDiff` 委托引擎；`LineDiff`（S1 临时 LCS）删除；`SplitLines` 统一走 `DiffText`；`GitFixtureBuilder` 补 `core.quotepath=false`（§9 风险表 S2 项）。
- `tests/GitUI.Diff.Tests`（新项目）：91 用例（下表）；`tests/GitUI.Git.Tests` 增补 `UnicodePathDiffTests`（3 用例）。
- `scripts/verify-s2.ps1`：构建零警告 → 全量测试 → 黄金用例 → oracle → 性能基准，一键执行。

**验证**：`dotnet build` 全解决方案零警告零错误；`dotnet test` 300 用例全绿（Core 54 + Diff 91 + Shell 38 + Git 117，本环境 ConPTY 集成 10 条也完整运行通过）；黄金用例 32/32；oracle 10/10；性能基准见下。

**测试矩阵**（GitUI.Diff.Tests）：

| 类 | 用例 | 内容 |
|---|---|---|
| GoldenLineDiffTests | 32 | 黄金用例集：纯增/删（首中尾）、单行改、gap6 合并 / gap7 拆分、跨块移动、整文件替换、空↔非空、全同、CRLF↔LF、EOF 换行、空行内容、context 0/1/100/clamp、100 处分散修改、重复行追加/重排、超长单行、中文、tab/space；每个用例同时断言"应用 hunk 精确还原新文本" |
| WordDiffTests | 8 | 标识符整体替换、CJK 逐字、空白段、空串、段串接回原行（通用性质） |
| EncodingSnifferTests | 13 | BOM 三种、UTF-8 中英混排、GBK 判定、Latin1 重音、截断 UTF-8、GBK roundtrip、BOM 剥除、UTF-16 LE |
| BinaryDetectorTests | 6 | 纯文本/NUL/窗口边界 7999:8000/空/中文 |
| LargeFileFilterTests | 4 | 5MB 与 20k 行的边界（恰好等于不算超限） |
| TextDiffPipelineTests | 14 | 端到端：二进制两侧、字节/行数上限、边界值仍 diff、GBK 端到端、编码覆盖、null 侧=新增/删除、EOF 标志、context 透传 |
| GnuDiffOracleTests | 10 | 与 `diff -u` 对照：块划分允许不同但①应用结果=新文本 ②净行数变化一致 ③无差异判定一致；8 个确定性随机种子 + 2 个固定用例；找不到 diff.exe 时软跳过 |
| DiffPerformanceTests | 4 | 20k 分散 100 处修改 <300ms / 20k 整块替换 <300ms / 全异 5k 预算兜底 / 20k 全同快路径 |
| DependencyCheckTests | 1 | GitUI.Diff 不引用 LibGit2Sharp / GitUI.Git / GitUI.App |

**性能基准**（本机实测，Debug 构建）：

- 20k 行分散 100 处修改：**12ms**（阈值 300ms）
- 20k 行中间整块替换（500→600 行）：**18ms**
- 20k 行完全相同：**3ms**
- 5k×5k 完全不同（预算兜底路径）：**188ms**，产出单个整段替换 hunk，结果仍正确

**关键实现决策**：

1. **DiffPkg 不存在，自研 Myers**：设计稿选型"DiffPkg（Microsoft 内部 diff 库）"，NuGet 查证该包不存在（0 结果）。按设计意图（VSCode 同款 Myers 算法）自研，落点 `GitUI.Diff`；性能要求（20k < 300ms）远超达标。
2. **行语义全项目统一到 `DiffText`**：S1 的 `SplitLines` 有两处问题——"a\n" 会多出幻影空尾行（S1 测试用 InRange 掩盖了）；且剥除所有 `\r` 会让 CRLF→LF 变成"无差异"，与 git 矛盾。S2 起以 `DiffText` 为准：无幻影尾行、`\r` 属于行内容；EOF 是否有换行符由 `TextDiffResult` 的标志单独携带（`"a\nb"` vs `"a\nb\n"` 行内容相同 → 无 hunk，与 git 的 `\ No newline` 标记走渲染层不同路）。
3. **块头遵循 git**：纯新增/纯删除块（0 计数一侧）的起始行 = 插入/删除点前一行行号，文件最前为 0（`@@ -1,0 +2,1 @@`）；这与 S1 `BuildInsertionHunk` 的全文件新增约定一致，`ParseUnifiedDiff` 解析 libgit2 patch 也天然一致。
4. **锚点分割 + 预算回退**（性能护城河）：纯 Myers 对"完全不同的超大文件"是 O(D²) 灾难；唯一行锚点把分散修改切成微窗口（20k×100 处修改 12ms 的来源）；锚点缺失的窗口（全是重复行）才走 Myers，预算 `max(65536, (n+m)×1024)` 步，耗尽退化为整段替换——结果永远正确，只是块划分非最小（设计允许"块划分不同但内容等价"）。
5. **编码探测的 GBK 阈值**：GBK 与 Latin1 不可双检（Latin1 任何字节都合法），启发式要求"每个高位字节都构成合法 GBK 双字节序列且 ≥2 对"——`café`（1 对候选）判 Latin1，真实 GBK 中文文件（≥4 对）判 GBK。编码可经 `TextDiffOptions.EncodingOverride` 手动覆盖（§4.4）。
6. **oracle 的等价性断言**：与 GNU diff 允许块划分不同（锚点/预算路径都会造成合法差异），因此不比对 hunk 结构，只断言三件事：引擎输出应用到旧文本 = 新文本、净行数变化与 GNU 一致、"无差异"判定一致。

**踩坑**（全部实测抓出）：

1. **middle snake 反向坐标的蛇长符号**：反向（从末端起算）找到的蛇，实际坐标长度是 `xr - xr0`（延伸量），写反成 `xr0 - xr` 会得到负长度 → 递归窗口非法 → IndexOutOfRange / 无进展递归栈溢出（xunit 进程直接崩溃，且堆栈只会显示一串 ComputeRange）。这是 Myers 线性空间变体最隐蔽的实现错误。
2. **组内 Equal 必须作为上下文行输出**：合并后的编辑块区间里夹着的 Equal op，在组装 hunk 体时要输出为两侧的 `" "` 上下文行；漏掉这个分支会把它当插入行（`+`），表现为上下文行全部变成 `+` 行、旧侧丢行。
3. **编辑组区间是排他的**：单编辑块的组 `[start, end)` 必须 `ends.Add(k + 1)`，写成 `k` 会让 `ops[end-1]` 取到前一个操作（单编辑 hunk 直接越界崩溃）。
4. **锚点唯一性必须两侧分别计数**：单一差值计数（a 侧 +1、b 侧 -1）无法区分"两侧各一次"（=0）与"两侧各两次"（=0），后者会误判为锚点，产生漏发插入行的错误编辑脚本。
5. **测试工具自身也要测**：GNU diff 输出解析器最初在切换 hunk 时未清空行缓冲，导致后续 hunk 累积前一 hunk 的所有行（净行数、added/deleted 全错）。oracle 数值异常时先怀疑解析器，再怀疑引擎。
6. **xUnit2029**：`Assert.Empty(collection.Where(...))` 会报 xUnit 分析器警告（TreatWarningsAsErrors 下即失败），改用 `Assert.DoesNotContain`。

**对 S1 的两处修正**（随 S2 语义统一）：

- `ComputeDiff_MultipleSeparateChanges_MultipleHunks`：原用例的修改相距 3 行，旧 LineDiff 永不合并所以期望多 hunk；git 语义（gap ≤ 2×context 合并）下是单 hunk。用例改为相距 ≥7 行断言多 hunk，另补 `ComputeDiff_NearbyChanges_MergeIntoSingleHunk` 固化合并行为。
- `SplitLines` 幻影尾行修正后，`GetFileDiff` 对纯新增/删除文件的 hunk 不再多出空 `+` 行（原 S1 测试用 `InRange(3,4)` 掩盖的行为）。

### 11.12 Git Bash 承载位置变更（2026-10-03）

**决策**：经用户确认，Git Bash 不再作为右侧停靠面板（占用主显示区域），改为左侧导航栏中与其他页签**同级**的导航项，选中时占据主内容区。§4.1 / §4.7.2 / §十 已同步更新。

**交付**：

- `GitUI.App/Pages/BashPage`（新，代码构建）：原 ConsolePane 的工具条 + 输出区 + 输入行 + 状态条整体迁入；实例在窗口生命周期内缓存（`_bashPage ??=`），切换页签不丢输出；监听 `ISettingsStore.Changed` 同步"跟随仓库"开关（Ctrl+Shift+J 全局切换时页签 UI 自动刷新）。
- `MainWindow`：根 Grid 3 列改回 2 列，`_titleBarStrip` ColumnSpan 3→2；删除 ConsolePane 列、自绘拖拽手柄、折叠三处联动、宽度 clamp 等右栏专属逻辑（约 300 行）；导航项新增 `("\uE756", "Git Bash", "bash")`（分支与设置之间）；`Ctrl+J` 语义改为页签切换（不在页签 → 进入；在页签 → 回 Log）；工具条"折叠面板"按钮移除（页签天然全屏，无折叠语义）。
- `AppSettings`：移除 `ConsolePaneCollapsed` / `ConsolePaneWidth`（右栏宽度/折叠状态失去载体）；`Normalize` 移除对应 clamp。旧设置文件里的 `consolePane*` 键加载时被忽略（System.Text.Json 默认行为），有测试固化。
- 无障碍补齐：导航按钮与汉堡按钮补 `AutomationProperties.Name`（§6.8 要求，S7 扫描前置）。
- `scripts/smoke-bash-nav.ps1`（新）：UIA 冒烟——找到侧边栏 Git Bash 按钮 → Invoke 进入 → 断言页内工具条与输入框出现。

**验证**：`dotnet build` 零警告；Core.Tests 51/51（含旧版设置键兼容用例）；UIA 冒烟通过（侧边栏五项：Log / 变更 / 分支 / Git Bash / 设置，点击后 Bash 页内容出现）。

**对后续阶段的影响**：

- S3b（TerminalCanvas）直接落在 `BashPage` 内，不再涉及窗口级 Grid/列操作；
- S0e 的"面板未打开时不启动进程"语义变为"未进入页签不启动"，`Lazy` 会话单例不变；
- §4.7.2 的 `Alt+Enter`（面板最大化）随右栏废弃；`Ctrl+Shift+C/V` 保持，S3b 实装。

### 11.13 S3 实施记录（2026-10-03）

**交付**：

- `GitUI.Diff/Render`（纯渲染管线，零 UI 依赖，与引擎同程序集）：
  - `DiffRenderModel`：`DiffHunk[]` → 视觉行序列。并排模式每行左右两格（纯增/删与段长不齐的余量一侧放 `Filler` 填充格）；内联模式单格、删除行在前（unified 顺序）。行号跨 hunk 连续追踪（git 0 计数语义：0 计数侧无行号）；tab 展开到 8 列制表位；"\ No newline at end of file" 标记行（由 `TextDiffResult` 的 EOF 标志驱动，仅标记真实存在内容的侧）；`ChangeBlocks`（连续变更区间，Alt+↑/↓ 导航单元）；`EnsureWordDiff(first,last)` 惰性字级差异——构建时只做 1:1 行配对（VSCode 同款），可视行的配对行才调 `ComputeWordDiff` 并缓存（单对 >4096 字符跳过防 O(n·m)）。
  - `DiffLayoutEngine`：模型 + `DiffMetrics` + `DiffViewport` → `DiffFrame`（`FillRectCommand`/`TextCommand` 绘制命令列表）。行高 18px 固定栅格；只绘可视区 + 上下 overscan 20 行（上方行以负 y 输出）；行号槽固定不随水平滚动；并排两列均分、文本按等宽格**逐 run 软件裁剪**（列边界处首字符 ceil/末字符 floor，不依赖图形栈裁剪，杜绝压到行号槽）；内联双行号槽 + `+`/`-` 标记列；当前变更块左缘 3px 高亮条。
  - `DiffPalette`：浅/深两套语义色（GitHub Diff / VSCode 配色基准），管线与测试只见 `DiffColorKind`。
  - `DiffMetrics`：行高 18、字符宽默认 7.8（运行期由控件实测注入）、GutterPadding 8、OverscanRows 20。
- `GitUI.Controls`（新 WinUI 类库）：`DiffCanvas` 控件（纯代码构建）——Win2D `CanvasControl` 即时绘制，翻译绘制命令为 `FillRectangle`/`DrawText`；双 `ScrollBar`（行滚动 + 水平滚动）；字符宽与垂直居中偏移用 `CanvasTextLayout` 实测（DIP 坐标，DPI 档位变化才重算）；`ActualThemeChanged` 换调色板；键盘 ↑↓/PgUp/PgDn/Home/End/←→，`Alt+↓/↑` 变更块跳转（最小滚动，块不可见时定位到 1/3 屏）；滚轮 3 行/格；`Message` 空态文案（二进制/大文件/无差异）。
- `GitUI.App`：`DiffPreviewWindow`（S3 手动验证工具，非正式页签）——路径输入 → 提交列表（最近 100）→ 变更文件列表 → DiffCanvas 渲染；设置页新增"开发工具 → 打开 Diff 渲染预览（S3 验证）"入口。
- `tests/GitUI.Render.Tests`（新 Headless 渲染测试工程，61 用例）：软件光栅化 `PixelBuffer`（FillRect → 像素缓冲，**截图对比**层）+ 命令级**几何断言**。
- `scripts/verify-s3.ps1`（一键：构建零警告 → 全量测试 → 渲染管线 → 性能基准）；`scripts/smoke-diff-preview.ps1`（UIA 冒烟）；`scripts/capture-diff-preview.ps1` / `capture-diff-inline.ps1`（截屏视觉核查工具）。

**验证**：`dotnet build` 全解决方案零警告零错误；`dotnet test` **363 用例全绿**（Core 51 + Diff 91 + Render 61 + Shell 38 + Git 122）；UIA 冒烟通过（设置 → 预览窗口 → 打开本仓库 → 选提交/文件 → Diff 视图渲染）；截屏视觉核查通过（并排/内联/字级高亮/Alt+↓ 当前变更条/中文渲染，见下）。

**测试矩阵**（GitUI.Render.Tests）：

| 类 | 用例 | 内容 |
|---|---|---|
| ModelSideBySideTests | 15 | 上下文配对、纯增/删填充、修改对 1:1、段长不齐余量、hunk 头、跨 hunk 行号跳变、EOF 标记（单/双侧/无）、空输入、tab 展开、MaxTextColumns、变更块划分 |
| ModelInlineTests | 6 | unified 顺序（ctx-del-add-ctx）、双行号列、无填充行、字级配对属主、EOF 标记、CJK 内容 |
| WordHighlightTests | 7 | 段串接覆盖两侧、配对格共享分段表、范围惰性、幂等缓存、超长对跳过、未配对行无高亮、CJK 逐字 |
| LayoutGeometryTests | 14 | 18px 栅格 y 坐标、hunk 头全宽、行号右对齐固定、水平滚动只移文本（含列边界整格裁剪）、字级段 x 映射（含前导 Equal 段占列）、长行裁剪（48 字符 = colW/charW）、overscan 负 y、FirstRow 夹紧、当前变更条、内联标记列、空模型 |
| PixelRenderTests | 8 | 像素级颜色块断言：增/删/上下文/填充/hunk 头背景、字级高亮矩形与行背景区分、当前变更条、overscan 裁剪、内联整行背景 |
| PaletteTests | 3 | 全种别已配、主题差异、字级高亮与行背景可区分 |
| RenderPerformanceTests | 4 | 10k 行首帧 <200ms、并排/内联 120 帧滚动 <33ms、一屏字级 <16ms |
| DependencyCheckTests | 2 | 渲染管线程序集不引用任何 UI/图形栈/git |

**性能基准**（本机实测，Debug 构建）：

- 10k 渲染行 diff（≈1240 hunk）首帧（模型 + 可视区字级 + 布局）：**14ms**（阈值 200ms；模型 14ms + 字级/布局 <1ms）
- 10k 行 120 帧滚动模拟：**平均 0.07ms / 峰值 2.75ms**（30fps 帧预算 33ms）
- 一屏（60 行）字级差异计算：<16ms（惰性，仅可视区）

**关键实现决策**：

1. **命令式渲染管线 + Win2D 薄壳**：布局产出与图形栈无关的绘制命令，Headless 测试用软件光栅化做像素断言；`DiffCanvas` 只做事件接线与 Win2D 翻译。"截图对比 + 几何断言"两层验证都不需要 GPU/XAML 运行时（本机 ConPTY 环境损坏的教训：凡是能脱离系统服务验证的都要能脱离）。
2. **字级差异惰性化**：10k 行 diff 若构建时全量算字级会吃掉首帧预算；改为 `EnsureWordDiff(可视区±overscan)`，滚动时增量计算并缓存，实测首帧字级开销 <1ms。
3. **等宽格软件裁剪**：列边界处按 `ceil/floor` 整格裁剪文本 run，部分可见字符整格丢弃——与图形栈裁剪无关，像素测试完全确定，且杜绝长行 bleed 到行号槽。
4. **Win2D 需要 RID**：`Microsoft.Graphics.Canvas.dll` 按架构解析，AnyCPU 构建下不可引用（WIN2D0001）。App/Controls 固定 `RuntimeIdentifier=win-x64` + `AppendRuntimeIdentifierToOutputPath=false`（输出路径形状不变，脚本零改动）。
5. **脚本 UTF-8 BOM**：PowerShell 5.1 对无 BOM 的 UTF-8 脚本按 ANSI/GBK 读取，中文字符串会吞掉引号导致解析错误；`smoke-*.ps1`/`capture-*.ps1`/`verify-*.ps1` 必须带 BOM。
6. **CanvasControl 度量 API 实测**：本机 Win2D 1.4.0 的 `CanvasTextLayout` 无 `LayoutMetrics`/`GetLineMetrics()`（与常见教程不同），用 `LayoutBounds.Width` 量字符步进、`LineMetrics[0].Height` 量自然行高；WinUI 3 投影无可重写的 `OnPointerWheelChanged`，改事件订阅。

**踩坑**：

1. **S1 遗留 bug：`ParseHunkHeader` 把真实仓库的 hunk 头全部解析错**（视觉核查抓出）：旧实现 `header.IndexOf('-')` 后把 `"-1,7 +1,7 @@"` 整段喂给 `ParseRange`——`int.TryParse("-1")` 成功 → OldStart = **-1**；计数部分 `"7 +1,7 @@"` 解析失败回退 → OldCount = **1**。渲染表现为块头 `@@ --1,1 +1,1 @@`、行号 -1/0 不可见（`>0` 才绘制）、后续从 1 重排。S1 的 DiffHunkParsingTests 只断言行内容、从未断言块头字段，因此一路绿灯。已修复（按空白分词、剥符号再解析）并补 5 个回归用例（含节标题、`-0,0` 纯增、省略计数=1）。
2. **GetCommitDiff 的 hunk 无 EOF 标志**：libgit2 patch 中的 `\ No newline` 行在 `ParseUnifiedDiff` 中被静默丢弃，`DiffResult` 也不携带 EOF 信息——提交 diff 暂无 EOF 标记行（`TextDiffPipeline` 来源的 diff 有）。S4/S5 接线时若需要，让服务层透出该标志即可，渲染端已支持。
3. **性能基准负载要按"渲染行数"设计**：首版用"10k 行 100 处修改"只有 792 渲染行（hunk 少）；改为每 8 行一处修改（> 2×context 保证 hunk 不合并）才与设计的"10k 行 diff"对齐。

**手动验证清单状态**（design.md §8-S3）：本仓库（含中文、长行、表格、markdown）并排/内联渲染无错位 ✅；10 个真实仓库 × 20 个真实 diff 的人眼核查留给使用者，入口：设置 → 打开 Diff 渲染预览，配合 `scripts/capture-diff-preview.ps1`（并排）与 `capture-diff-inline.ps1`（内联 + Alt+↓）截屏工具。

### 11.14 S4 实施记录（2026-10-03）

**交付**：

- `GitUI.ViewModels`（新项目，net8.0 纯逻辑层，零 UI/零 git 依赖，由 DependencyCheckTests 验证）：
  - `LogViewModel`：Log 页状态机——分页加载（每页 50，`Items` 累积）、搜索过滤、按天分组与折叠状态（跨分页保留）、选中提交 → 变更文件。重活在 `Task.Run`（服务为同步接口），状态经 `SemaphoreSlim` 串行化，`StructureChanged`（结构性）/`SelectionChanged`（轻量）两个事件由 UI 经 DispatcherQueue 回投；公开 Task 方法 await 返回后状态即可见（集成测试直接驱动，无需 UI）。
  - `LogFilterParser`：搜索语法 → `LogFilter`。`author:` `branch:` `after:` `before:` `topic:`（前缀大小写不敏感、支持引号包裹含空格的值），自由词按字面子串匹配（`Regex.Escape` + `(?i)`），多词 AND（`(?i)(?=.*p1)(?=.*p2)`）；`topic:` 值原样透传正则语义；非法日期降级为自由词；同前缀后者生效。
  - `LogDayGrouping` / `LogFormatting`：按 CommitterDate 本地日分组（与排序键一致）、组头标题（今天/昨天/同省年/跨年 + 星期）、行内相对时间。
  - `LogRow` 扁平行模型（组头行 / 提交行 + 徽章 + 预拼好的 meta 文本），UI 元素工厂直接消费。
- `GitUI.App/Pages/LogPage`（重写，纯代码构建，stub XAML 删除）：工具条（仓库路径 + 最近仓库下拉 + 分支下拉 + 搜索框 + 刷新）→ `ItemsRepeater`（StackLayout 虚拟化）+ 自定义 `IElementFactory`；单分支时间轴（行内贯穿竖线 + 节点圆点，合并提交放大换色）；按天分组折叠（组头按钮切换，折叠状态在 VM 按日期键保存）；滚动距底 < 240px 触发 `LoadNextPageAsync`；右侧详情（提交头 / 变更文件列表 / DiffCanvas 复用 S3）；状态条（"已加载 N / 共 M · K 个分组"，UIA 断言锚点）；全部交互元素带 AutomationProperties.Name。
- `MainWindow`：Log 页签缓存（`_logPage ??=`，切页签不丢已加载状态与选中），注入 `LibGit2RepositoryService`。
- `LibGit2RepositoryService.GetLog` 快路径（见下"关键实现决策"1）；`GitFixtureBuilder` 新增 `CommitOn`（指定时间戳提交，`BulkCommits` 末尾补写 commit-graph）。
- `tests/GitUI.ViewModels.Tests`（新项目，50 用例）；`tests/GitUI.Git.Tests` 增补 `GetLogFastPathTests`（4 用例，fast/慢路径交叉验证）。
- `scripts/verify-s4.ps1`（一键：构建零警告 → 全量测试（Category!=Perf）→ 100k 性能基准）；`scripts/smoke-log-page.ps1`（UIA 冒烟）。

**验证**：`dotnet build` 全解决方案零警告零错误；`dotnet test` **417 用例全绿**（Core 51 + ViewModels 50 + Diff 91 + Render 61 + Shell 38 + Git 126）；UIA 冒烟通过（打开本仓库 → 首屏 12 条 → `author:nonexistent-xyz` 0 条 → `author:wyndam` 12 条 → 分组折叠 12→9→恢复 → 点击提交 → 22 个文件项 → Diff 视图渲染）。

**测试矩阵**（GitUI.ViewModels.Tests）：

| 类 | 用例 | 内容 |
|---|---|---|
| LogFilterParserTests | 13 | 空输入、自由词字面转义（含正则元字符）、topic 原样透传、author/branch 前缀（大小写不敏感）、引号值、日期（含 T 写法/引号空格时刻/非法降级）、组合、重复前缀后者生效、前缀空值降级 |
| LogGroupingTests | 8 | 同日单组保序、跨日边界（23:59/00:01）、跳过空日、今天/昨天/同年/跨年标题、空输入 |
| LogFormattingTests | 6 | 今天/昨天/天数/同年月日/跨年、29/30 天边界 |
| LogViewModelTests | 15 | 打开归一化、非仓库报错、空仓库、**分页 50→100→120 无重叠**、越页空操作、**跨天分组边界**、**折叠行数与恢复**、折叠跨分页保留、author 过滤（含 0 条）、自由词/大小写/多词 AND/清空、branch: 限定可达、UI 分支与搜索叠加、日期区间过滤、选中加载变更文件、根提交空文件、徽章与 meta、事件触发 |
| LogPagePerformanceTests | 2 | **10 万提交首屏 50 条 < 500ms**、**下一页 < 200ms**（Trait Perf，verify-s4 单独跑） |
| DependencyCheckTests | 2 | ViewModels 不引用 UI/git 程序集、解析器纯静态 |

**性能基准**（本机实测，Debug 构建，10 万提交 fixture 由 fast-import 灌入）：

- 首屏（Open，50 条，含 GetLog + 解析 + 分组 + 行构建）：**125ms**（阈值 500ms）
- 稳态重开（Refresh）：**112ms**
- 滚动加载下一页（skip=50）：**112ms**（阈值 200ms）

**关键实现决策**：

1. **GetLog 大仓库快路径：libgit2 revwalk → git CLI**（本阶段最重要发现）：
   - libgit2sharp 的 revwalk 有**每句柄首次迭代 ~600ms 的固定冷启动开销**（10 万提交 packfile；`Head.Tip` 对象读取仅 1ms 证明 ODB 冷读无问题；写 commit-graph 也无法消除——libgit2 不读 commit-graph）。"每请求开合句柄"的 S1 模型下，取 50 条也要付 600ms，任何分页方案都爆 500ms 预算。
   - git CLI 读同一仓库（现代 Git 自动维护 commit-graph）单次冷读 ~70ms。因此无过滤查询改为两次 `git rev-list`（`--count` + `--skip/--max-count` 窗口）分别供给精确 TotalCount 与分页窗口，再经 libgit2 `Lookup`（首对象读 1ms）物化 50 个 CommitNode——§3.1"git CLI 兜底"授权范围内。
   - **仅大仓库启用**（pack idx ≥ 128KB ≈ 2k 提交）：CLI 进程启动 ~25ms，小仓库纯 libgit2 全遍历稳态 ~5ms 更快，保住 S1 的 GetLog(10) 稳态 < 50ms 阈值。idx 检查失败/CLI 不可用/ref 不存在均回退原全量遍历路径，正确性不受影响。
2. **分页 + 全量 TotalCount 的语义保持**：S1 的 `TotalCount = 过滤后精确总数` 不变（Topo/Log/快路径交叉测试固化）。慢路径（带过滤）维持全量遍历——过滤查询通常结果集小且是用户显式动作，不设 100k 预算。
3. **分组用 CommitterDate（本地日）**：与 GetLog 排序键一致，避免"作者日期 3 天前"出现在"今天"分组的错位；行内相对时间同键。
4. **ItemsRepeater + 轻量行工厂**：`IElementFactory` 不做容器回收（每页 50 行、实存量 = 可视区量级），行构建即点即弃；选中高亮以 `_selectedSha`（页面字段）为唯一事实源，工厂重建行时不会出现陈旧选中态；选中变化只改两个按钮背景 + 右侧详情，不重设 ItemsSource（避免滚动跳动）；结构性变化（翻页/过滤/折叠）才整体重建并按需回到顶部。
5. **搜索语法解析与 UI 分支选择叠加**：查询文本未写 `branch:` 时 UI 分支下拉生效，写了则以查询为准——两处入口语义一致且可测试（`BuildFilter` 单点合并）。
6. **UIA 断言锚点**：状态条文案 `已加载 N / 共 M` 设计为脚本断言锚点；注意 TextBlock **不能**设 `AutomationProperties.Name`（显式 Name 覆盖动态文本，冒烟第一次运行即踩中），让其 UIA Name = 文本内容本身。

**踩坑**（全部实测抓出）：

1. **libgit2 revwalk 每句柄首迭代 ~600ms**：见关键决策 1。诊断过程中先用分段计时锁定（open 15ms / rev-list count 373ms / walk 50 = 589ms / 物化 50 ≈ 0ms），再用"新句柄单次对象读取 1ms vs 新句柄 walk 50 = 580ms"分辨 ODB 冷读与 revwalk 冷启动。
2. **快路径一刀切会打爆小仓库阈值**：rev-list 两次进程启动 ~45ms，S1 的 GetLog(10) 稳态阈值 50ms 直接失败——性能优化必须双端对齐旧有预算，最终以 pack idx 大小自适应分流。
3. **`(?=p1)(?=p2)` 是"同一位置同时命中"**：多词 AND 写成无 `.*` 的相邻前瞻后，"fix deref"（两词出现在不同位置）永远匹配失败。改 `(?=.*p1)(?=.*p2)`（服务端 MatchesTopic 已用 Singleline，跨行安全）。
4. **fixture 时间戳的时区对称性**：`CommitOn` 用 `ToUniversalTime().ToString("u")` 存 UTC，libgit2 读回时带存储时区的 DateTimeOffset；分组键是 `LocalDateTime`——测试若用 `TimeSpan.Zero` 构造"23:59"，在 +8 时区实际落在次日 07:59，跨日断言必炸。测试时间戳一律用本地 offset 构造。
5. **git rev-list 对时间倒挂的线性链只能按链序输出**（父不先于子的基本契约，date/topo 均不例外），与 libgit2 GIT_SORT_TIME 的纯时间序在倒挂历史上不一致——fixture 提交一律按时间递增构造，产品代码不依赖两种序的差异。
6. **xUnit2029 之外又见 xUnit2013**：`Assert.Equal(1, col.Count())` / `Assert.Equal(0, col.Count)` 在 TreatWarningsAsErrors 下即编译失败，用 `Assert.Single` / `Assert.Empty`。
7. **命名参数大小写**：record/构造器参数 `limit`（小写）不能以 `Limit:` 命名传入（CS1739），且探针代码编译失败时 `dotnet test` 默认跑**旧二进制**——基准数字突然"稳定"而代码刚改过时，先确认构建是否真的成功。

### 11.15 S5 实施记录（2026-10-03）

**交付**：

- `GitUI.Core`：
  - `UnifiedPatch`（新）：unified diff 解析（`ParseHunks`，自 LibGit2RepositoryService 迁出，语义不变）+ `SplitHunks`（按 "@@" 边界切成可直接 `git apply --cached` 的分块，hunk 级暂存的数据源）。两法同界判定，块序号与渲染 hunk 一一对应。
  - `GitOperationException`（操作名 + 完整 stderr + 退出码）/ `PushException`（§5.3 分类 + 下一步建议文案）/ `PushErrorClassifier`（纯文本 stderr 分类规则，单测覆盖）/ `DiffNumStat`。
  - `IRepositoryService` 扩展 S5 写操作（Stage/Unstage/Commit/GetWorktreePatch/GetIndexPatch/ApplyIndexPatch/Push/GetNumStat/GetRecentCommitSubjects）与 S6 分支操作（CreateBranch/RenameBranch/DeleteBranch/Checkout/MergeBranch/Rebase/Pull/MergeBase/UniqueCommits/BranchDeleteImpact）。
- `GitUI.Git`：上述接口实现。提交用 libgit2（`repo.Commit` + 提交前 index 空 Guard）；git CLI 操作经 `ArgumentList` 逐参数注入（无注入面）；`Push` 120s 超时、失败按 stderr 分类抛 `PushException`；`Stage` 等 `git add -A --`、`Unstage` 等 `git reset -q HEAD --`（unborn HEAD 回退 `git rm --cached`）；`ApplyIndexPatch` 走 stdin 管道。
- `GitUI.ViewModels`：
  - `ChangesViewModel`：三层列表（Conflict/Changes/Staged/Unversioned）+ numstat 行数统计；勾选（IDEA 语义：Changes/Unversioned 默认勾、Unversioned 默认不勾，勾选偏好按 (分类, 路径) 键保存）；hunk 级暂存（Staged 视图反向 apply）；提交（in-flight 守卫幂等 + 勾选文件预览 + 冲突文件拦截）与推送（失败分类 + RetryPush）；`CommitPrefixSuggester`（按勾选文件路径给 conventional 前缀）。
  - **部分暂存追踪**（`_partiallyStaged`）：做过 hunk 级暂存的文件在提交时跳过整文件 add——整文件 add 会覆盖 index 里的部分暂存结果（集成测试抓出）。
- `GitUI.Controls/DiffCanvas`：`DiffRow.HunkIndex`（行 → hunk 归属）+ `DiffRenderModel.TryGetHunkRowRange/TryGetHunkIndexAtRow` + 点击画布选块（`HunkSelected` 事件）+ 选中块半透明覆盖层 + `SetSelectedHunk`。
- `GitUI.App`：`RepositoryContext`（App 级当前仓库，Log/Changes 页共享，任一页打开即全局感知）；ChangesPage 重写（纯代码构建：三层列表行 = Button（UIA InvokePattern）+ CheckBox + numstat；右侧 diff + 暂存/撤销按钮（按视图类型启用）；底部提交栏：前缀建议/最近消息/文件预览/Ctrl+Enter）。
- 测试：`ChangesViewModelTests`（12：三层+统计、默认勾选、勾选提交 3 文件进 HEAD、取消勾选 Staged 先撤销、空消息拒绝、并发双击幂等、二次点击无重复、冲突拦截、层移动、hunks/chunks 计数、前缀建议、最近消息）；`HunkStagingTests`（3：**单 hunk 暂存 → 提交 → HEAD 只含该 hunk**、Staged 视图反向撤销单块、损坏 patch 报错且状态不变）；`PushFlowTests`（5：stderr 分类规则、**e2e 提交并推送到 bare 远程、远端 tip == 本地 tip**、non-fast-forward 分类+重试、不可达域名网络分类、无失败重试空操作）。
- 脚本：`verify-s5.ps1`（构建零警告 → 全量测试 → UIA 冒烟）；`smoke-changes-page.ps1`（自建临时仓库 → 打开 → 选文件 → Diff 出现 → 暂存 → 提交 → **断言 HEAD 消息/内容/工作区状态**）。

**验证**：`dotnet build` 零警告零错误；`dotnet test` **435 用例全绿**（Core 51 + ViewModels 68 + Diff 91 + Render 61 + Shell 38 + Git 126）；`VERIFY-S5 PASS`（UIA 冒烟全链路 + 权威 git 状态断言）。

**关键实现决策**：

1. **hunk 级暂存的权威语义**：渲染 hunk 与 `git apply` 分块同以 "@@" 为界（`UnifiedPatch` 单点保证）；正向 apply = 工作区变更进 index，反向 apply（Staged 视图）= 从 index 撤销；应用后按路径在新层重新定位选中文件并重载 diff（`ReloadSelectedDiff`）。
2. **提交的三步原子序**：暂存勾选 → 撤销未勾选的 Staged → `repo.Commit`；提交前检查 index 非空（幂等第一道），VM 层 in-flight 守卫（并发双击只产生一个提交——并发测试证明），提交后清空勾选偏好。
3. **推送失败不影响提交生效**：`CommitOutcome = (Sha, PushFailure?)`，push 异常被分类捕获；重试走独立 `RetryPushAsync`。分类规则按 stderr 关键词（认证/网络/non-fast-forward），本地 bare 远程 + 域名不可达 + 竞争 clone 三种真实路径覆盖。
4. **ChangesPage 行用 Button 而非 Border+PointerPressed**：UIA InvokePattern 只有 Button 提供，冒烟可驱动（LogPage 同款）。

**踩坑**（全部实测抓出）：

1. **InfoBar 进视觉树即触发 XAML fail-fast（0xc000027b，combase E_FAIL）**：本机（RDP 会话 + WinAppSDK 2.5）上 InfoBar 无法使用，表现为点击"变更"页签应用整体崩溃且 UIA Invoke 返回 E_FAIL（进程短暂存活）。用分段排除法（环境变量逐段跳过构建）定位到 InfoBar；换成 TextBlock 横幅后恢复。与 §11.1 的 MicaBackdrop 崩溃签名同源——WinUI 控件在损坏会话上的兼容性不可假设。
2. **整文件 add 覆盖部分暂存**：`git add -A -- <file>` 会把工作区全部变更写进 index，抹掉此前 `git apply --cached` 的选择性暂存。提交路径对 `_partiallyStaged` 集合内的文件跳过整文件暂存。
3. **VM 层操作完成后忘记触发 StructureChanged**：StageFiles/StageHunks 只发 SelectionChanged，三层列表与状态条永远不刷新（UIA 冒烟"暂存后状态没变"——git index 实际已暂存，纯 UI 断层）。把 `StructureChanged` 收进 `LoadCoreAsync` 统一触发。
4. **UIA 断言锚点不能设显式 AutomationProperties.Name**（§11.14 同坑第二次）：TextBlock 的显式 Name 覆盖动态文本，状态条/文件头都因此失真过；凡承载动态文本的 TextBlock 一律不设 Name。
5. **PowerShell 冒烟：函数名 `Git` 遮蔽 git.exe** 导致 `& git` 无限递归（CallDepthOverflow）；数组参数展开 `@arr` 对原生命令有效。**双重 BOM**（utf-8-sig 读后未剥再以 sig 写回）让 `-File` 解析炸出 "'#'不是命令"。**数组 `-notmatch`** 返回非匹配元素集合（恒真），判断"是否包含"要用 `-match` + `-not`。
6. **temp 仓库必须隔离用户全局 git 配置**（autocrlf）：冒烟脚本自建仓库后 `config core.autocrlf false`，否则 CRLF 幻影修改让层分类漂移（GitFixtureBuilder §11.9 的教训在脚本侧重演）。

### 11.16 S6 实施记录（2026-10-03）

**交付**：

- `GitUI.ViewModels/BranchesViewModel`：Local/Remote 分支树（组头 + `[name] (sha · tip 主题)` 行，HEAD 分支加 ✓ 前缀高亮）；Create / Rename / Delete / Checkout / Merge(--no-ff 可选) / Rebase / FastForward(merge --ff-only) / Pull / Pull --rebase / Push；**删除两段式**——`RequestDeletePreview` 用 `BranchDeleteImpact`（从目标可达、其余全部引用不可达的提交，精确影响集）计算丢失提交，产出 `BranchDeletePreview.ConfirmationText`（"将丢弃 N 个提交：<短SHA 列表>"，N 与实际一致是 S6 通过标准）；FastForward 额外做终态校验（HEAD==目标 tip）。
- `GitUI.App/Pages/BranchesPage`（纯代码构建）：树（ItemsRepeater + 行 Button，UIA 可驱动）+ 顶部 Pull / Pull Rebase / Push（§4.5 IDEA 同款）+ 操作栏（检出/创建/重命名/删除/合并/变基/快进，按选中项与 IsHead 动态启用）；删除/创建/重命名走 `ContentDialog`，确认按钮带"确认"前缀（与页面操作按钮在 UIA 命名空间不重名）；与 Log/Changes 共享 `RepositoryContext`。
- `GitUI.Git`：`FastForward`（`git merge --ff-only`，新增接口方法）；`DeleteBranch` 改走 CLI `git branch -d/-D`（libgit2sharp 0.32 的 `Branches.Remove` 静默无效，见踩坑 1）。
- 测试：`BranchesViewModelTests`（12）：分组与 tip 元信息、**checkout 后 HEAD 移动**、创建/重命名 ref 终态、**删除后 ref 消失 + 影响集 N 值与 rev-list --count 一致 + 确认文案含正确 N 与短 SHA**、全合并分支零影响免 force、merge --ff 线性化（单父）、merge --no-ff 产生双父合并提交、**rebase 后线性化（单父链含上游提交）**、分叉时 fast-forward 被拒且 HEAD 不动、冲突合并报错且 HEAD 不动、状态条 transient 语义。
- 脚本：`verify-s6.ps1`（构建零警告 → 全量测试 → UIA 冒烟）；`smoke-branches-page.ps1`（自建临时仓库：树显示 → 检出 feature（git HEAD 权威断言）→ 删除确认对话框断言"将丢弃 1 个提交" → 取消保留 → 确认删除后 ref 消失）。

**验证**：`dotnet build` 零警告零错误；`dotnet test` **449 用例全绿**（Core 51 + ViewModels 80 + Diff 91 + Render 61 + Shell 38 + Git 126 + Render/其余）；`VERIFY-S6 PASS`（UIA 冒烟：确认文案 N 值与实际独有提交数一致、终态 ref 断言全过）。

**关键实现决策**：

1. **删除影响的精确定义**：`BranchDeleteImpact = 从目标分支可达 且 从其余全部引用（本地+远程跟踪）不可达` 的提交——即删除后真正不可达的集合。影响为空 ⇒ 删除安全（无需 force）；非空 ⇒ UI 强制展示确认文案后以 `-D` 执行。
2. **快进用 `--ff-only` 而非"普通 merge + 后置校验"**：第一版先 merge 再校验 HEAD==tip，结果分叉时 git 已经创建合并提交（HEAD 被污染）才报错——语义错误。`--ff-only` 让 git 在分叉时直接拒绝（exit ≠ 0），HEAD 永不污染；VM 层保留终态校验作为第二道。
3. **危险操作文案格式遵循 §6.4 原文**：`将丢弃 N 个提交：a3f9c2, b71d44…`（短 SHA）；测试同时断言 N 值（= `rev-list --count main..side`）与 SHA 归属（log -1 验证该 SHA 即 side 独有提交）。
4. **恢复路径**：确认对话框明示"删除后可从 reflog 或列出的提交 SHA 重建分支"；集成测试以"删除前记 tip → 删除 → 从 tip 重建 → 可达数恢复"验证（Git GUI 重建的标准等价路径）。

**踩坑**（全部实测抓出）：

1. **libgit2sharp 0.32 `Branches.Remove(string, bool)` 静默无效**：调用不抛异常、ref 原样保留（`Remove(string)` 单参重载存在但 (string,bool) 调用被编译器接受后运行期空转）。`Remove(Branch, bool)` 重载不存在（CS1503）。删除改走 `git branch -d/-D`（§3.1 CLI 兜底授权），失败以 stderr 上浮。
2. **LoadCoreAsync 无条件清 `_error`**（与 S5 的 StructureChanged 遗漏同族）：BranchesViewModel 的写操作失败设置 `_error` 后，随后的树刷新把它抹掉——快进失败/合并冲突在 UI 上不可见。错误的生命周期归写操作管，刷新路径不得触碰。
3. **内容 vs 主题混淆**（测试侧三连）：`ShowFile(rev, path)` 返回文件内容（"2"），提交主题走 `log --format=%s`（"main-2"）——断言前先分清。
4. **ContentDialog 按钮命名**：对话框 PrimaryButton 与页面操作按钮同名（"删除"）会让 UIA FindByName 命中歧义；对话框按钮统一"确认××"前缀。

### 11.17 S7 实施记录（2026-10-03）

**交付**：

- `GitUI.Core`：`FuzzyMatcher`（fuzzy 打分：子串命中 +60/位置加成/词首 +8，subsequence 每字 +2/词首 +8/连续段 +3，大小写不敏感，空 query 全命中）；`ISettingsStore.Replace(AppSettings)`（整体替换，导入用）+ `JsonSettingsStore.ToJson/FromJson`（与存储文件同格式，解析失败回默认不抛出）。
- `GitUI.App/MainWindow`：
  - **命令面板**（Ctrl+Shift+P / 标题栏"命令面板"按钮）：Popup + 过滤输入 + ListView，↑↓ 选择、Enter/双击执行、Esc/轻点关闭；14 条命令（页签跳转×5 / 刷新 / 新建窗口 / 设置导入导出 / 主题×3 / Diff 模式×2）；fuzzy 过滤按 `FuzzyMatcher` 排序。
  - **全局快捷键**：Ctrl+1..5 直达页签（sidebar 顺序 Log/变更/分支/Git Bash/设置）、Ctrl+Tab 循环切换、F5 刷新当前页（Log/Changes/Branches 暴露 `RefreshAsync()`，其余页空操作）。Ctrl+J / Ctrl+Shift+J / Ctrl+Enter / Alt+↑↓ 沿用既有。
  - **多窗口**（design.md §6.7）：`App.OpenNewWindow()`——MainWindow 实例自包含（页签缓存与 RepositoryContext 均为实例字段，天然可多开）；窗口列表跟踪，最后一个窗口关闭时持久化设置；窗口标题/标题栏文本随当前仓库更新（"仓库名 - GitUI"）。
  - **设置导入导出**：FileSavePicker/FileOpenPicker（`InitializeWithWindow` 附着窗口句柄）；设置页新增"设置文件"卡片（导出到文件…/从文件导入…，回调注入自窗口）。
- 脚本：`scripts/publish.ps1`（Release 自包含单目录发布：`-r win-x64 --self-contained`，App.csproj 以 Configuration 条件启用 `WindowsAppSDKSelfContained`——**不能经 -p: 全局传入，属性流到类库会触发 SDK guard 报错**）；`scripts/check-accessibility.ps1`（运行时 UIA 扫描：逐页签收集全部交互元素，Name 为空即违规 exit 1）；`scripts/smoke-command-palette.ps1`；`scripts/check-uia-conventions.ps1`（第一批已建）。
- `BashPage`：补 2 个缺失的交互元素 Name（输出区/命令输入）。

**验证**：`dotnet build` 零警告零错误；`dotnet test` **484 用例全绿**（Core 62 含 FuzzyMatcherTests 11 + ViewModels 103 + Diff 91 + Render 61 + Shell 38 + Git 126 + perf 13）；无障碍扫描 **97 个交互元素全部有 Name（零缺失）**；UIA 约定检查通过；四条冒烟全过（log / changes / branches / command-palette）；**发布产物验证**：publish 自包含 227.8MB 单目录，`smoke-log-page.ps1 -Exe publish\GitUI.App.exe` 在 Release 产物上全链路通过。

**关键实现决策**：

1. **命令面板触发双通道**：Ctrl+Shift+P（KeyboardAccelerator）+ 标题栏按钮。冒烟用按钮而非 SendKeys——本机 RDP 会话上键盘注入不可靠（AppActivate/SendKeys 静默失效），InvokePattern 稳定。
2. **多窗口零架构改动**：MainWindow 的页签缓存与 RepositoryContext 本就是实例字段（S5 设计时即按"将来可多开"建模），App 层只加窗口列表与关闭语义；代价是全局设置共享（最近仓库跨窗口同步，符合预期）。
3. **快速打分而非完整 fzf**：命令集 ~14 条，子串+subsequence 两层打分足够区分；`Score` 纯函数 headless 测试 11 例固化排序语义（§8-S7"断言 fuzzy 搜索排序"）。
4. **发布自包含按配置切换**：Debug 保持 `WindowsAppSDKSelfContained=false`（F5 快、依赖已装运行时），Release publish 自包含——比 -p: 全局传入安全。

**踩坑**：

1. **WindowsAppSDKSelfContained 经 `dotnet publish -p:` 传入会流向所有引用项目**，GitUI.Controls（类库）触发 SDK guard 报错"should not be applied to a class library"——必须限定在 App 项目内（Configuration 条件）。
2. **SendKeys/AppActivate 在 RDP 会话静默失效**（键进了但窗口没收到）：S7 冒烟全部改用 UIA InvokePattern 或真实鼠标事件。
3. **WinUI `Window` 没有 `GetWindowPointer`**：正确的 hwnd 访问是 `WinRT.Interop.WindowNative.GetWindowHandle(this)`。
4. **无障碍扫描的第一版误报**：Bash 页输出框（只读 TextBox，ControlType=Edit）与命令输入共用 Edit 类型，补 Name 时两处都要覆盖。

**S7 补充：通用 git diff（2026-10-03 同日）**：

- 应用户需求补充 §4.2 P1"任意两点比较"基础版：`GetTreeDiff(workDir, aSha, bSha)`（任意两提交树对比，不要求父子）；Log 页详情区新增比较栏——"设为比较基准"（钉住所选提交为 A）→ 点击其他提交 B 即显示 B 对 A 的树 diff → "清除比较基准"恢复默认父 diff。
- 踩坑：比较栏按钮可用性依赖 `_vm.Selected`，而它在异步 `SelectAsync` 内赋值——只在同步 `SelectCommit`/`Rebind` 刷新会留下"按钮禁用但已有选中"的窗口期（冒烟 ElementNotEnabled 抓出），`UpdateDetail`（SelectionChanged 路径）必须同步刷新。
- 测试：`TreeDiffTests`（5：跨提交对比增/删/改、方向反转、同树空 diff、未知 SHA 抛错、VM 基准流程）；smoke-log-page 扩展基准设置/清除链路。

**遗留与范围外**（known-issues.md 持续跟踪）：

- Git Bash 支线（S2b TerminalParser / S3b TerminalCanvas / S0e 接线）仍为并行阶段，未在本批范围；
- 发布签名（v1 无证书，未做）与干净 Win11 虚拟机安装验证（需环境）；
- IRepositoryService 接口拆分（S7 重构窗口决策：暂缓，无 mock 压力，机械改动收益低）。

---
**对后续阶段的影响**：

- S7（命令面板/快捷键/多窗口）：分支操作已全部收敛为 `BranchesViewModel` 的 Task 方法，命令注册表可直接映射；
- `ContentDialog` + XamlRoot 模式可复用到 S7 的全局确认/输入场景；
- 危险操作确认的两段式（Preview 数据 + 对话框）适用于 reset/rebase --onto 等 S7 补充操作。

---
**对后续阶段的影响**：

- S6 直接复用：`GitOperationException`、`RunGit`、`RepositoryContext`、行 Button 模式、确认对话框数据源（`BranchDeleteImpact`/`UniqueCommits` 已就位并随 S5 落地测试）。

---
**对后续阶段的影响**：

- S5（Changes 页）与 S6（Branches 页）复用 `LogViewModel` 的"Task 方法 + 双事件 + DispatcherQueue 回投"骨架与 `LibGit2RepositoryService` 注入方式；
- `HasLargePack` 分流与 rev-list 快路径对只读查询成立；S5/S6 需要写操作的命令（commit/checkout）继续走 libgit2/CLI 直连，不受影响；
- LogPage 的 `_selectedSha` 单一事实源 + 行工厂模式可直接套用到 Changes 三层列表；
- S0e 接线时，"在终端查看" 右键命令可挂在 LogPage 的提交行 Button 上（当前未加右键菜单，S4 范围外）。

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
| 终端 | **ConPTY + 自绘 `TerminalCanvas`（方案 A，见 §4.7）** | 与 DiffCanvas 同族的自绘渲染策略，主题一致、可编程解析；代价是与 DiffCanvas 同级的技术风险 |
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
┌─ UI Layer：XAML Pages + Controls（LogPage, DiffView, BranchesPage, TerminalCanvas, ConsolePane...）
├─ ViewModel：LogViewModel, ChangesViewModel, CommitViewModel（可测试，无 UI 依赖）
├─ Domain：GitModel（CommitNode, DiffHunk, TreeEntry, BranchRef）── 不可变记录类型
├─ RepositoryService：把 GitModel 映射到 libgit2sharp 调用
├─ Shell：ConptySession + TerminalParser + BashLocator（ConPTY P/Invoke 与终端状态机，见 §4.7）
└─ Infrastructure：SettingsStore, EditorLauncher, EncodingSniffer, LargeFileFilter
```

---

## 四、界面布局设计

### 4.1 窗口主布局（2026-10-03 更新：Git Bash 为导航页签）

```
┌──────────────────────────────────────────────────────────────────────┐
│ TitleBar: [仓库名·分支▾] 搜索框(⌘K)                      [⋯]        │
├────────┬─────────────────────────────────────────────────────────────┤
│ NavView│  主内容区（按页签切换，占满剩余宽度）                       │
│ ┌─────┐│ ┌─ Log / Changes / Branches / Git Bash / Settings ───────┐ │
│ │ Log ││ │                                                         │ │
│ │ 变更││ │   （选中 Git Bash 页签时：工具条 + 终端 + 状态条）      │ │
│ │ 分支││ │                                                         │ │
│ │Bash ││ │                                                         │ │
│ │ 设置││ │                                                         │ │
│ └─────┘│ └─────────────────────────────────────────────────────────┘ │
└────────┴─────────────────────────────────────────────────────────────┘
```

- **可停靠多面板**：主区支持左右分屏（左 Log / 右 Diff），实现方式为自定义 `Grid` + 拖拽 `GridSplitter`，v1 不做完整 DockingManager。
- **Git Bash 页签**：与 Log/Changes/Branches/Settings 同级的导航项，选中时占据主内容区（§4.7.2）；`Ctrl+J` 切换该页签。
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

### 4.7 Git Bash 面板（自绘 PTY 终端，v1 核心能力）

**定位**：右侧一栏常驻终端，用户可边写命令边看 diff，覆盖所有 GUI 未直接支持的 git 操作（`git blame`、`git reflog`、交互式 rebase、`git config` 等）与用户自己的 shell 脚本。

#### 4.7.1 方案选型（关键决策）

三种实现路径的取舍：

| 方案 | 形态 | 代码量 | 是否完整 bash | v1 结论 |
|---|---|---|---|---|
| **A. 自绘 PTY** | ConPTY 取字节流 + 自绘 `TerminalCanvas` 渲染 | 800–1500 行 | ✅ | ✅ **采用** |
| B. 命令执行面板 | 输入框 + 输出区，仅 git 命令 | 150–300 行 | ❌ | 降级兜底（§九 回退点） |
| C. 外部 ConHost 窗口 | ConPTY + `SetParent` 挂 conhost.exe | 300–500 行 | ✅ | 备选，v1 不做 |

**采用 A 的理由**：
1. **主题一致**：自绘可完全跟随 Mica 与设置里的主题色（字体、字号、ANSI 色板），C 会让 conhost 的白/黑窗口色与主界面割裂；
2. **可编程**：能拦截输出做结构化解析（`git status` 输出 → `IndexState` 回写），B/C 拿不到；
3. **交互可扩展**：未来可加"命令历史搜索"、"命令块折叠"、"选中行发送到 Changes 页暂存"，A 是这些能力的唯一底座。

**代价**：A 需要自建 PTY 集成 + 终端状态机解析器 + 自绘渲染器，与 DiffCanvas（§4.4）同级技术风险，是**项目第 2 大技术风险点**，独立列为 §S3b 阶段（§八）。

#### 4.7.2 承载位置与交互（2026-10-03 变更：导航页签）

**位置**：Git Bash 是左侧导航栏中与 Log/Changes/Branches/Settings **同级**的页签，选中时占据主内容区全宽（详见 §11.12 变更记录；最初设计为右侧停靠面板，已废弃）。

```
Grid  2 列 × 2 行
 Row0 = TitleBar (48)        跨 2 列
 Row1 = Content    *
   Col0 = Sidebar         (Auto，由 Border.Width 控制：200 / 72)
   Col1 = Main            (1, Star)——PageHost 按 _currentKey 切换页面
```

- `BashPage` 实例在窗口生命周期内**缓存复用**（`_bashPage ??=`），切换页签不丢输出；这与 §5.1 的"TerminalSession 为 App 级单例"一致；
- 页签与 sidebar 折叠（`Ctrl` 汉堡按钮）互不干扰；
- 面板内容占满主内容区，不响应标题栏拖拽热区。

**工具条**（32px 高，页内顶部）：

```
┌──────────────────────────────────┐
│ ▣ Git Bash                ⧉  ⋯ │
└──────────────────────────────────┘
```

| 按钮 | 图标 | 行为 |
|---|---|---|
| `⧉` 清屏 | `FontIcon` | 发送 `\x1b[3J\x1b[K\x1b[3d`（清屏 + 清 scrollback + 光标归位），**不杀进程** |
| `⋯` 更多 | `MenuFlyout` | 重开 shell / 用默认编辑器打开 `.bashrc` / 切换工作目录 / 复制输出 |

（原"折叠面板"按钮随右栏一并移除——页签天然全屏，无折叠语义。）

**状态条**（20px 高，底部）：

```
git 2.47.1   bash 5.2   bash@128×30   main*   ✓ Running
```

显示 git 版本、bash 版本、当前 PTY 字符尺寸、当前仓库分支、会话状态。

**快捷键**：

| 快捷键 | 行为 |
|---|---|
| `Ctrl+J` | 切换到 Git Bash 页签；已在页签上时回到 Log（VSCode 语义的页签化） |
| `Ctrl+Shift+J` | 切换"跟随仓库工作目录"模式（全局生效，页签内 UI 监听设置变更刷新） |
| `Ctrl+Shift+C` | 复制输出区选中文本 |
| `Ctrl+Shift+V` | 粘贴到输入行 |

#### 4.7.3 自绘终端渲染器

新增 `TerminalCanvas` 控件（`Grid` + `DrawingContext`，与 `DiffCanvas` 同族），负责把 PTY 字节流渲染为可视字符。

**状态机**：解析 ConPTY 输出的 ANSI/VT 序列，维护一张 `TerminalBuffer`（`columns × rows` 的字符网格 + 光标位置 + 属性栈）：

| 状态 | 处理的序列 | 结果 |
|---|---|---|
| Ground | 可打印字节 | 写入 buffer[cursor]，前进光标 |
| Ground | `\n` `\r` `\b` `\t` `\x07` `\x0e` `\x0f` | 控制字符处理（`\t` 跳到下一个 8 列对齐） |
| Esc | `[` `]` `(` `)` `7` `8` `=` `>` `M` `D` `E` `c` | 进入对应子状态 |
| CSI | `A` `B` `C` `D` `E` `F` `G` `H` `J` `K` `m` `r` `s` `u` | 光标移动、清屏、SGR 属性、保存/恢复光标 |
| OSC | `\a` `\x1b\\` | 标题、超链接（v1 仅解析 `\x1b]0;...\x07` 设置标题） |

**渲染**：

- 只在可视区域 + 上下 overscan 20 行的区间绘制；
- 行高 = `fontSize * 1.2`，字符宽 = 固定 `fontSize * 0.6`（等宽字体）；
- 字号默认 13，字体 `Cascadia Mono` / `Consolas` / 系统回退；
- 行内字符按 SGR 属性分组，每组一个 `DrawText` 调用，减少绘制开销；
- 光标：闪烁的 `BlockCursor`（500ms 周期），当前活动行用半透明底色标记；
- 滚动：`ScrollViewer` 包裹 buffer 视图，scrollback 上限 10000 行（可配）。

**输入**：

| 输入源 | 处理 |
|---|---|
| 键盘 `Key` | 转 Unicode codepoint → UTF-8 字节 → 写入 PTY |
| 方向键 / 功能键 | 手写转义序列：`\x1b[A` 上、`\x1b[C` 右、`\x1b[5~` PgUp、`\x1b[1;5~` Ctrl+PgUp |
| 粘贴 | `TextBox.Paste` 事件 → UTF-8 编码 → 写入 PTY |
| 鼠标点击 | 仅聚焦，v1 不做鼠标坐标写入（ConPTY 鼠标协议有兼容性问题） |
| 剪贴板选中文本 | 选中矩形区域，按 buffer 字符网格提取，忽略样式属性 |

#### 4.7.4 ConPTY 集成

**调用序列**（Windows SDK，`CreatePseudoConsole` 需 Win10 1803+）：

```csharp
// 1. 建立 IO 管道
CreatePipe(out hInputRead, out hInputWrite, sa, 0, NULL, NULL);
CreatePipe(out hOutputRead, out hOutputWrite, sa, 0, NULL, NULL);

// 2. 启动 conhost 承载伪控制台
STARTUPINFOEX si = { dwFlags = EXTENDED_STARTUPINFO_PRESENT, ... };
// 用 SetThreadpoolAttribute 挂 PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE + hPC

// 3. 创建伪控制台
CreatePseudoConsole(size: (120, 30),
                    hInput: hInputWrite,
                    hOutput: hOutputRead,
                    0, out hPC);

// 4. 在伪控制台上启动 bash
CreateProcessW(bashPath, "-l -i", ..., &si, out pi);

// 5. 输出读线程：阻塞 ReadFile(hOutputRead, buffer, out bytesRead, null)
//    → 转 TerminalParser → buffer 更新 → 触发 TerminalCanvas 重绘

// 6. 输入写：WriteFile(hInputWrite, utf8Bytes, len, out _, null)
```

**关键实现约束**：

| 约束 | 说明 |
|---|---|
| 输出读线程必须是 `Thread` | 不能用 `Task.Run`，`Task` 会被线程池回收导致 buffer 撕裂 |
| `SECURITY_ATTRIBUTES.bInheritHandle = true` | 否则子进程拿不到管道句柄 |
| `CREATE_NO_WINDOW` | 否则弹出黑框 |
| `ClosePseudoConsole` 必须在退出前调用 | 否则 conhost 进程泄漏 |
| 高 DPI 换算 | `columns = floor(widthPx / charWidth * 96 / dpi)`，同源 §4.1.1 |
| 字体度量 | 用 `TextGeometry` 计算 `charWidth`，不用 `ActualWidth`（会随窗口抖动） |

**工作目录绑定**：

- 打开仓库时若面板未打开，`cwd` 记下但不启动；
- 已打开时通过 PTY 写入 `cd "<repo path>"\n`；
- 用户手动 `cd` 后 `_followRepo` 置 false 并 toast 提示；
- 切换仓库时若 `_followRepo` 为 true，自动写入新的 `cd` 命令。

**未安装 Git 的处理**：

1. 首启检测 `BashLocator.TryLocate()`；
2. 未找到时面板显示空状态：`未检测到 Git for Windows` + `下载` 按钮（跳转 https://git-scm.com/download/win） + `手动指定路径` 输入框；
3. 找到后启动 `bash -l -i` 并显示欢迎提示。

**崩溃与退出**：

- `WaitForSingleObject(pi.hProcess, INFINITE)` 在后台线程；
- bash `exit` / `Ctrl+D` → 显示"会话已结束 · 点击重开"占位；
- 面板未打开时不启动进程，`Lazy<TerminalSession>` 延迟初始化；
- 窗口关闭时 `ClosePseudoConsole` → `TerminateProcess` → `CloseHandle`，全在 `try/finally`。

#### 4.7.5 接口与分层

新增 `GitUI.Shell` 项目，不引用 libgit2sharp，避免污染 Core/Git 层：

```csharp
namespace GitUI.Shell;

/// <summary>终端会话抽象，供 UI 与测试共用。</summary>
public interface ITerminalSession : IDisposable
{
    void Start();
    void Write(ReadOnlySpan<byte> data);
    event Action<ReadOnlyMemory<byte>>? OutputReady;
    event Action<int>? Exited;
    void Resize(int columns, int rows);
    bool IsRunning { get; }
    string? Title { get; }
}

/// <summary>终端解析器：字节流 → buffer 更新。</summary>
public sealed class TerminalParser
{
    public TerminalBuffer Buffer { get; }
    public void Feed(ReadOnlySpan<byte> data);
}

/// <summary>字符网格，非线程安全，由主线程读。</summary>
public sealed class TerminalBuffer
{
    public int Columns { get; }
    public int Rows { get; }
    public char this[int col, int row] { get; }
    public SgrAttribute this[int col, int row] { get; }  // 前景色/背景色/粗体/斜体
    public (int col, int row) Cursor { get; }
}

/// <summary>bash 可执行文件定位：三级回退。</summary>
public static class BashLocator
{
    public static bool TryLocate(string? overridePath, out string bashPath, out string? error);
}
```

**测试策略**（对齐 §八 的可独立验证原则）：

| 层 | 手段 | 覆盖 |
|---|---|---|
| `BashLocator` | 单测，mock `PATH` 与注册表 | 三级回退、空格路径、不存在路径、权限不足 |
| `TerminalParser` | 纯算法单测（黄金用例集） | CSI/OSC/SGR、颜色、光标、清屏、行回绕、CRLF、`\t` 制表、超长行截断、Unicode 组合字符、UTF-8 多字节 |
| `TerminalCanvas` | Headless 渲染测（截图对比） | 10k 行 scrollback 渲染 < 200ms、闪烁动画、主题切换刷新、DPI 变化 |
| `ConptySession` | 集成测 | 启动/写入/读取/resize/退出/退出码/异常退出 |
| `ConsolePane` | UI 自动化（WinAppDriver） | 折叠/展开、拖拽、清空、跟随仓库切换、粘贴、复制 |
| 端到端 | 冒烟脚本 | 打开仓库 → 开面板 → `git status` → 断言 stdout 出现在输出区 |

`ITerminalSession` 抽象让 UI 层可用 `FakeTerminalSession` 单测，不需真启 conhost——这是 §九 中"ConPTY 需管理员权限部分场景"这条风险的缓解手段。

#### 4.7.6 与现有模块的联动

| 联动点 | 触发 | 行为 |
|---|---|---|
| Log 页 → 面板 | 右键提交 → "在终端查看" | 面板 `cd` 到仓库 + 写入 `git show <sha>` |
| Changes 页 → 面板 | 右键文件 → "在终端打开" | 面板 `cd` 到文件所在目录 + 写入 `git status -- <path>` |
| Branches 页 → 面板 | 右键分支 → "在终端 checkout" | 面板写入 `git checkout <branch>` |
| 面板输出 → Changes | 用户跑 `git status` 后 | 解析 stdout 更新 `IndexState`（可选，默认关，v2 开启） |
| 提交对话框 → 面板 | 提交前预览 | 面板写入 `git diff --cached` |

**v1 只做前 4 项的单向联动**（GUI → 面板），反向解析留 v2。

#### 4.7.7 技术风险（专属）

| 风险 | 影响 | 缓解 | 验证 |
|---|---|---|---|
| 自绘终端渲染性能不足（大量输出卡顿） | 高 | 只绘可视区 + overscan 20 行；`DrawText` 批量合并 | S3b |
| ANSI/VT 序列解析 bug 导致乱码或崩溃 | 高 | 黄金用例集 ≥ 50 个，覆盖 xterm.js 的兼容性测试集 | S2b |
| ConPTY 需管理员权限的部分场景 | 中 | 用 `SECURITY_ATTRIBUTES` + 默认 DACL，测试普通账户运行 | S0d |
| bash 未安装 | 中 | 首启检测 + 一键下载 + 状态栏红点 | S0c |
| 中文路径 / 中文提交信息乱码 | 中 | ConPTY 内部 UTF-8 + 启动参数 `chcp 65001` | S0d |
| 全屏程序（`vim`、`less`）渲染错位 | 中 | 解析器必须支持 `rmir`（滚动区）、`8`/`>`（应用光标/键）、`H`/`F`（上下边界） | S3b |
| 长时间运行后管道读线程泄漏 | 中 | `try/finally` + `CloseHandle`；单测模拟异常退出 | S0d |
| 高 DPI 下字符宽度计算错误 | 中 | `TextGeometry` 计算 + `dpi/96` 换算，同源 §4.1.1 | S3b |
| 输入焦点错乱（面板与主内容区互抢） | 中 | `GotFocus`/`LostFocus` 显式管理，键盘输入仅在面板聚焦时转发 | S3b |
| 大输出拖垮内存（`tail -f /var/log`） | 中 | scrollback 上限 10000 行，超出自动丢弃最旧；toast 提示 | S3b |

---

## 五、数据流与状态管理

### 5.1 状态分层

```
SettingsStore        ← 全局设置（主题、默认编辑器、diff 模式、终端配置），JSON 持久化
RepoSession          ← 仓库级状态，每开一个仓库一个实例
 ├─ IndexState       ← git status 结果，监听文件变化刷新
 ├─ LogState         ← rev-list 分页缓存 + 过滤条件
 ├─ DiffState        ← 当前打开的 diff 目标
 └─ WorkingTreeWatcher ← 文件监视器（FileSystemWatcher）
TerminalSession      ← 终端会话，App 级单例（Lazy 初始化，与窗口同生命周期）
 ├─ ITerminalSession  ← ConPTY + 读写线程
 └─ TerminalBuffer    ← 字符网格 + 光标 + SGR 属性
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
   - `Ctrl+J` 切换 Git Bash 面板显示/隐藏
   - `Ctrl+Shift+J` 切换"面板跟随当前仓库目录"模式
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
│  ├─ GitUI.Shell/             # ConPTY + TerminalParser + BashLocator（不引用 libgit2sharp）
│  ├─ GitUI.ViewModels/        # 所有 ViewModel（CommunityToolkit.Mvvm）
│  └─ GitUI.Controls/          # 可复用控件（LogListItem, DiffCanvas, TerminalCanvas, ConsolePane, BranchTree）
├─ tests/
│  ├─ GitUI.Core.Tests/
│  ├─ GitUI.Git.Tests/         # 用临时 repo fixture 做集成测试
│  ├─ GitUI.Diff.Tests/        # diff 算法单测（黄金用例）
│  └─ GitUI.Shell.Tests/       # TerminalParser 黄金用例 + ConptySession 集成测试
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

### S0b · Git Bash 面板外壳（ConPTY 之前）

**范围**：`MainWindow` 根 `Grid` 改为 3 列（Sidebar / Main / ConsolePane），`GridSplitter` + 拖拽 + 折叠；工具条 32px、状态条 20px；`AppSettings` 新增 6 个终端字段（`ConsolePaneCollapsed` / `ConsolePaneWidth` / `BashPath` / `TerminalFontFamily` / `TerminalFontSize` / `TerminalFollowRepo`）并补 `Normalize` 归一化；`Ctrl+J` / `Ctrl+Shift+J` 快捷键；**ConPTY 用 stub**——面板里放一个 `TextBox` 模拟输出。

**可独立验证**：
- `dotnet build` 零警告通过；
- 手动折叠/拖拽/重启后宽度与折叠状态持久化；
- 单元测试：`AppSettings` 终端字段的反序列化（正常、越界、缺失、损坏文件，≥ 4 个用例）；
- 与 sidebar 折叠互不干扰（两个都能独立折叠，`_consoleColumn` 与 `_sidebarColumn` 各管各的）。

**通过标准**：面板能开能关、能拖能保存、快捷键生效；空壳不崩溃。

### S0c · Bash 定位器

**范围**：`GitUI.Shell` 项目；`BashLocator.TryLocate()` 三级回退（`settings.BashPath` → `where bash.exe` → `%ProgramFiles%\Git\bin\bash.exe`）；路径含空格、权限不足、不存在等异常处理。

**可独立验证**：
- 单元测试 4 场景全绿：`PATH` 里有、Git 安装目录、都不存在、路径含空格；
- `TreatWarningsAsErrors=true` 下零警告；
- 不引用 libgit2sharp（依赖检查）。

**通过标准**：定位器单测全绿，异常路径全部处理。

### S0d · ConPTY 集成（不渲染）

**范围**：`ConptyNative.cs` P/Invoke（`CreatePipe` / `CreatePseudoConsole` / `ResizePseudoConsole` / `ClosePseudoConsole` / `CreateProcessW`）；`ConptySession` 实现 `ITerminalSession`；输出读线程（`Thread`，阻塞 `ReadFile`）；`FakeTerminalSession` 测试替身。

**可独立验证**：
- 集成测试：`bash -c "echo $SHELL && pwd"` 断言 stdout 出现在 `OutputReady` 事件；
- `resize` 后 `tput cols` 返回新值；
- bash `exit` 后 `Exited` 事件触发且退出码正确；
- 异常退出（`kill -9`）不导致句柄泄漏（`CloseHandle` 单测）。

**通过标准**：`echo` / `ls` / `git status` / `less` / `exit` 五条路径全绿。

### S2b · TerminalParser（无渲染）

**范围**：终端状态机解析器，与 S2 Diff 引擎并行独立；处理 CSI / OSC / SGR / 光标 / 滚动 / 行回绕 / 制表 / CRLF / UTF-8 多字节 / Unicode 组合字符 / 超长行截断。

**可独立验证**：
- 纯算法单测，无 UI、无 PTY、无 conhost；
- 黄金用例集 ≥ 50 个（参考 xterm.js 兼容性测试集）；
- 与 `tmux` 输出的真实会话录制对比（作为 oracle）；
- 性能基准：10 MB 输出流解析 < 500ms。

**通过标准**：黄金用例全绿；性能基准达标。

### S3b · TerminalCanvas 渲染（技术风险验证）

**范围**：自绘 `TerminalCanvas`（`DrawingContext`），与 S3 DiffCanvas 同族；行高 = `fontSize * 1.2`；只绘可视区 + 上下 overscan 20 行；SGR 分组批量绘制；闪烁光标；scrollback 上限 10000 行；主题切换刷新；DPI 变化重算字符宽度；`Ctrl+Shift+C` 复制选中区。

**可独立验证**：
- Headless 渲染测试工程：喂入 S2b 的 parser 输出，断言"第 N 行第 M 列是什么字符、什么颜色"（截图对比 + 几何断言）；
- 性能基准：10k 行 scrollback 下滚动帧率 ≥ 30fps；
- 手动验证清单：`git status` / `git log --graph` / `less` / `vim` / `htop` / `tree` 六个真实终端程序渲染无错位；
- 全屏程序测试：`rmir`（滚动区）、`8`/`>`（应用光标/键）、`H`/`F`（上下边界）全支持。

**通过标准**：10k 行首帧渲染 < 200ms；滚动无掉帧；6 个真实终端程序视觉检查通过。

> **关键决策点**：如果 S3b 性能不达标或全屏程序渲染有系统性 bug，**降级到方案 C**（`SetParent` 挂 conhost.exe），见 §九 的回退策略。这是终端能力唯一的架构回退点。

### S0e · 面板接线 + 与工作区联动

**范围**：`TerminalSession` 单例 `Lazy` 注入；跟随仓库模式；工具条三点菜单；Log/Changes/Branches 页右键菜单 → 面板命令；空状态（bash 未安装提示 + 下载链接）。

**可独立验证**：
- 打开仓库 → 面板显示 `pwd` = 仓库路径；
- 切仓库 → 面板自动 `cd`；
- 用户手动 `cd` → `_followRepo` 置 false 并 toast；
- Log 页右键"在终端查看" → 面板写入 `git show <sha>` 且 stdout 出现；
- 未安装 Git 时显示空状态卡片 + 下载链接可点击。

**通过标准**：6 条联动路径手动验证全通过；UI 自动化测试覆盖"开仓库 → 开面板 → 执行命令 → 看到输出"完整链路。

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
     │
     └── S0b ── S0c ── S0d ──┐
                              ├── S2b ── S3b ── S0e ── （并入 S7 打磨）
                              │
                              └── （S0d 与 S2b 并行，S3b 依赖 S2b + S0d）
```

- **可并行**：S1 与 S2 无依赖，可由两人并行；S3 依赖 S2；**Git Bash 支线（S0b/S0c/S0d/S2b/S3b/S0e）与 S1/S2/S3/S4/S5/S6 全程并行**，可由第三人或后续接入；
- **阻塞点**：S3 是 S4/S5 的共同前置（都复用 DiffCanvas）；S3 失败时走 §S3 的回退决策；S3b 是 S0e 的前置（复用 TerminalCanvas），S3b 失败时降级到方案 C；
- **回退成本**：S3 回退只影响 Diff 相关；S3b 回退到方案 C 只影响终端渲染方式，`ITerminalSession` 抽象不变，UI 层零改动；
- **接入点**：S0b 只需改 `MainWindow` 根网格，不触碰 S0 已有的 sidebar / titlebar / 主题逻辑，可与 S1/S2 同日启动。

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
| **自绘 TerminalCanvas 性能不足（大量输出卡顿）** | **高** | 只绘可视区 + overscan 20 行；SGR 分组批量绘制；scrollback 上限 10000 行 | **S3b** |
| **ANSI/VT 序列解析 bug（乱码/崩溃）** | **高** | 黄金用例 ≥ 50 个，参考 xterm.js 兼容性测试集；tmux 录制作为 oracle | **S2b** |
| **ConPTY 需管理员权限的部分场景** | 中 | `SECURITY_ATTRIBUTES` + 默认 DACL；普通账户冒烟 | S0d |
| **bash 未安装** | 中 | 首启检测 + 一键下载 + 状态栏红点 | S0c |
| **全屏程序（`vim`/`less`/`htop`）渲染错位** | 中 | 解析器支持 `rmir`/`8`/`>`/`H`/`F`；手动验证 6 个真实终端程序 | S3b |
| **管道读线程句柄泄漏** | 中 | `try/finally` + `CloseHandle`；异常退出单测 | S0d |
| **高 DPI 字符宽度计算错误** | 中 | `TextGeometry` 计算 + `dpi/96` 换算，同源 §4.1.1 | S3b |
| **面板与主内容区输入焦点互抢** | 中 | `GotFocus`/`LostFocus` 显式管理；仅聚焦时转发键盘 | S3b |
| **`tail -f` 类大输出拖垮内存** | 中 | scrollback 上限 + 溢出丢弃 + toast 提示 | S3b |

---

## 十、已确认的决策记录

| 项 | 决策 | 确认日期 |
|---|---|---|
| Git 引擎 | libgit2sharp 为主 + git CLI 兜底 | 2026-10-02 |
| Diff 视图 | 自绘 DiffCanvas | 2026-10-02 |
| 发布形态 | 自包含 exe，单目录 | 2026-10-02 |
| Repo Map | v2 再做，v1 用分支树覆盖 80% 需求 | 2026-10-02 |
| Git Bash 面板形态 | **方案 A：自绘 PTY + 自绘终端渲染**（不采用方案 B 命令面板或方案 C 外部 ConHost） | 2026-10-02 |
| Git Bash 面板位置 | ~~窗口最右侧一栏~~ **左侧导航页签（与 Log/Changes/Branches/Settings 同级），见 §11.12**（2026-10-02 原决策：最右一栏；2026-10-03 经用户确认变更） | 2026-10-03 |
| 终端承载层 | 新增 `GitUI.Shell` 项目，不引用 libgit2sharp | 2026-10-02 |
| 终端与 GUI 联动方向 | v1 只做 GUI → 面板（Log/Changes/Branches 右键写入命令）；面板输出 → IndexState 回写留 v2 | 2026-10-02 |

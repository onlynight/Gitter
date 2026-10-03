# 已知问题与技术债清单

> 状态：S4/S5/S6 验收后梳理（2026-10-03）；2026-10-03 第一批修复（1.1/1.2/1.3/1.4/1.6/1.7/1.8，见文末修复记录）
> 范围：当前 master（682d770..5383b0a 三次阶段提交后）的全部已知缺陷、设计妥协、未完成计划项与验证限制。
> 用途：S7（打磨与发布）的输入；每项标注影响与建议处置时机。

## 一、产品行为问题（已确认、未修）

### 1.1 hunk 部分暂存标记在提交后残留，可能吞掉后续提交 ✅ 已修复（2026-10-03）
- **现象**：对某文件做过 hunk 级暂存（`ChangesViewModel._partiallyStaged`）后，该标记在提交后不清除。用户下次勾选该文件整文件提交时，`CommitAsync` 会跳过整文件 `git add`——该文件的新修改静默不进 HEAD。
- **修复**：提交成功后与打开仓库时清空 `_partiallyStaged`（提交消费了 index 的部分暂存状态，工作区剩余改动是全新未暂存内容）。测试：`KnownIssuesFixTests.PartialStagedFlag_*`。

### 1.2 Log 页分支下拉不感知分支变化 ✅ 已修复（2026-10-03）
- **现象**：`LogPage.UpdateBranchCombo` 仅在 `WorkDir` 变化时重建。在分支页创建/删除/重命名分支后，Log 页的分支下拉仍是旧列表，直到重新打开仓库。
- **修复**：`BranchesViewModel.BranchListChanged`（创建/重命名/删除成功后触发）→ `BranchesPage` 转发 `RepositoryContext.NotifyBranchesChanged()` → Log 页 `LogViewModel.RefreshBranchesAsync()` 并强制重建下拉。测试：`BranchListChanged_FiresOnCreateDeleteRename` / `RefreshBranches_LogSeesBranchesCreatedInBranchesPage`。

### 1.3 RepositoryContext 通知是单向的（Changes/Branches → 无回传 Log）✅ 已修复（2026-10-03）
- **现象**：Log 页打开仓库会驱动 Changes/Branches 页自动加载（`context.Changed`）；反过来在 Changes 页打开另一个仓库后，Log 页仍停留在旧仓库。
- **修复**：LogPage 订阅 `context.Changed`，比对 WorkDir 不一致才跟随打开（自身打开时 WorkDir 已更新，天然防回环）。

### 1.4 冲突解决无引导 UI ✅ 最小闭环已补（2026-10-03）
- **现象**：合并/变基冲突后，Changes 页的"冲突"分组仅列出文件并拦截提交（"存在未解决的冲突文件"），没有标记已解决、打开编辑器、按侧采纳（Accept Current/Incoming）等任何引导。
- **修复**：Changes 页新增"在编辑器打开"按钮（设置指定 `ExternalEditor` 或系统默认关联程序）；选中冲突文件时"暂存文件"按钮动态换为"标记已解决"（git add 移除冲突条目）。行级 Accept 仍属 v2。

### 1.5 DiffCanvas 选块只支持单块（未修，低优先级）
- **现象**：点击 diff 画布仅记录一个选中 hunk；"暂存此块/撤销此块"一次只处理一块，多块要反复操作（每次 `git apply --cached` + 全量刷新）。
- **影响**：低（功能可用、效率欠佳）。
- **建议**：Ctrl/Shift 多选 + 批量 `StageHunksAsync`（VM 已支持 `IReadOnlyList<int>`，只差 UI）。处置时机：S7 打磨。

### 1.6 提交 diff 不显示 "\ No newline at end of file" 标记 ✅ 已修复（2026-10-03）
- **现象**：`GetCommitDiff`（libgit2 patch 来源）的 hunk 无 EOF 标志，`ParseUnifiedDiff` 丢弃该标记行（§11.13 遗留）；工作区 diff（TextDiffPipeline 来源）正常。
- **修复**：`DiffResult` 增加尾参 `OldEndsWithNewline`/`NewEndsWithNewline`（默认 true，向后兼容）；`UnifiedPatch.DetectEndOfNewline` 从 patch 标记行解析；`GetFileDiff` 直接读 blob 末尾；Changes/Log 页把标志透传 `DiffCanvas.Load`。测试：`DiffEndOfNewlineTests`（解析 4 例 + 服务层 3 例）。

### 1.7 错误提示无"复制完整输出" ✅ 已修复（2026-10-03）
- **现象**：`GitOperationException` 的 Message 只取 stderr 最后一行（≤300 字符）；异常对象携带完整 `StdError` 但 UI 横幅没有复制入口（design §5.3 要求"含 stdout/stderr 前 5 行 + 复制完整输出"）。
- **修复**：Changes/Branches ViewModel 增加 `ErrorDetail`（GitOperationException 取完整 StdError，其余取 ToString，成功路径清空）；页面横幅旁新增"复制错误详情"按钮（剪贴板）。测试：`ErrorDetail_CapturedForGitOperationException` / `ErrorDetail_ClearedWithNextSuccess`。

### 1.8 状态条 transient 消息不会自动消退 ✅ 已修复（2026-10-03）
- **现象**："已检出 xxx / 已删除 xxx"等成功消息一直停留到下一次操作或刷新，无超时。
- **修复**：`ClearTransient()`（Changes/Branches VM）+ 页面 5s `DispatcherQueueTimer`（每次 Rebind 重置，天然去抖）。测试：`ClearTransient_RemovesSuccessMessage`。

## 二、技术债与设计妥协

### 2.1 带过滤的 GetLog 未优化（10 万提交单次 >1s）
- **背景**：S4 快路径只覆盖无过滤查询；author/topic/时间过滤仍走 libgit2 全量遍历，且受 **libgit2 revwalk 每句柄冷启动 ~600ms**（10 万提交 packfile，commit-graph 无法消除，§11.14）叠加拖累。
- **影响**：大仓库上过滤查询明显慢（无预算要求，但可用性一般）。
- **建议**：过滤条件下推 rev-list CLI（`--author`/`--since`/`--grep`）；或引入常驻 Repository 句柄池（与 §3.2 线程模型一并设计）。处置时机：性能问题被用户感知时。

### 2.2 IRepositoryService 接口膨胀
- **现象**：25+ 方法混装只读查询与 S5/S6 全部写操作，ViewModel 依赖面过宽，mock 成本高。
- **建议**：按领域拆分（ILogService / IChangesService / IBranchService）或读写分离。处置时机：S7 重构窗口。

### 2.3 服务实例与线程模型偏离设计
- **现象**：MainWindow 为三个页签各 `new LibGit2RepositoryService()`（无共享、无 GitWorker 队列）；design §3.2 的"单 worker + 请求数据化"队列未接入——当前靠 ViewModel 层 SemaphoreSlim 串行化，libgit2 句柄"每请求开合"策略仍是安全底线。
- **影响**：无正确性问题（句柄不跨线程）；长任务（push/pull 120s）期间同页操作被 gate 阻塞。
- **建议**：S7 统一注入单例 + 评估是否需要 GitWorker（当前同步 Task.Run 模型实测够用）。

### 2.4 UIA 自动化约定无防护
- **现象**："承载动态文本的 TextBlock 一律不设 AutomationProperties.Name"是口头约定（设了就覆盖文本，冒烟锚点失效，§11.14/§11.15 两次踩中）；无脚本化扫描防止回归。
- **建议**：S7 无障碍扫描脚本同时校验"动态文本元素不得有显式 Name"。

### 2.5 InfoBar 弃用但根因未查
- **现象**：本机（RDP 会话 + WinAppSDK 2.5）InfoBar 进视觉树即 XAML fail-fast（§11.15），已全部改用 TextBlock 横幅。根因（SDK bug？会话环境？）未定位；换机器/升级 SDK 后行为未知。
- **建议**：干净桌面环境复测一次；若复现，最小 repro 上报 WinAppSDK。

### 2.6 Changes 页数据加载无分页、分支树 N+1 查询
- **现象**：`GetStatus` 全量返回（万级变更仓库单次加载慢，无预算断言）；`BranchesViewModel.LoadCoreAsync` 对每个分支各调一次 `GetCommit` 取 tip 主题（分支多时打开变慢）。
- **建议**：分支 tip 主题改为一次 `GetLog(Limit: N)` 反查；Status 大仓库实测后再定分页策略。

### 2.7 diff 行级操作未实现
- **现象**：design §4.4 的行级操作（冲突时 Accept Current/Incoming/Both）未做，S5 只交付 hunk 级暂存。
- **建议**：v2（与冲突解决 UI 一并设计）。

### 2.8 PowerShell 冒烟脚本可移植性
- **现象**：脚本硬编码 exe 绝对路径与默认仓库路径；临时仓库未隔离 HOME（已仓库级关闭 autocrlf/quotepath 并注入 user.name/email，全局 hooks 等仍可能渗入）。
- **建议**：路径参数化（已有 param 但 exe 路径写死）；fixture 式 HOME 隔离可复用 GitFixtureBuilder 思路。

## 三、未完成计划项（S7 及后续阶段输入）

| 项 | 出处 | 说明 |
|---|---|---|
| 命令面板（Ctrl+Shift+P） | §4.6 / S7 | 命令注册表 + fuzzy 搜索；分支操作已收敛为 VM Task 方法，可直接映射 |
| 全局快捷键 | §6.2 | Ctrl+1..4 / Ctrl+Tab / F5 / Ctrl+D 等大部分未接；Ctrl+J / Ctrl+Shift+J / Ctrl+Enter 已接 |
| 高 DPI 最小窗口尺寸 | §4.1.1 / §11.4 | GWL_MINTRACKSIZE 方案，S0 期崩溃未再尝试 |
| 多窗口（每仓库一窗） | §6.7 / S7 | 当前 RepositoryContext 是全局单仓库模型，多窗口需先改造为 per-window |
| 无障碍扫描 + 空状态 + toast 统一 | S7 | 列表/按钮 Name 已铺，扫描脚本未建 |
| settings 导入导出、打包签名 | S7 | MSIX/自包含 exe |
| Git Bash 支线 | S2b/S3b/S0e | TerminalParser/TerminalCanvas/面板接线全部未动，BashPage 仍是 stub |
| Log 页右键菜单 | §4.2 P1/P2 | 在终端查看 / Compare with selected / Cherry-pick / Tag here |
| Push 的 remote/branch 选择 | §4.3 | 当前 `git push` 无参数，依赖 upstream 配置，无 upstream 直接失败（分类为 Other） |
| 远程分支操作 | §4.5 | Fetch / Reset to / Compare 未做（远程分支当前只读展示） |
| Repo Map | §4.2 P2 | v2 决策不变 |

## 四、测试与验证的已知限制

1. **性能基准跨程序集并行抖动**：不带 Category 过滤直接 `dotnet test GitUI.sln` 时，Git.Tests 与 ViewModels.Tests 的 perf 基准可能并行争抢 CPU（历史上出现过 GetLog(10) 稳态 62ms > 50ms 阈值的偶发失败）。用 `verify-s4/s5/s6` 的 `Category!=Perf` / `Category=Perf` 分组规避；两程序集的 perf 各自加了串行 collection，但跨程序集无互斥。
2. **UIA 冒烟依赖中文 UI 文案与独占桌面**：元素定位用 Name 精确匹配（"变更 f.txt"、"将丢弃 N 个提交"等），英文/本地化环境必失败；两个冒烟脚本并发运行会互抢焦点，不可并行。
3. **Push 网络分类测试依赖 DNS 行为**：`Push_UnreachableRemote` 用 `invalid.invalid` 触发解析失败；特殊代理/hosts 环境下错误文本可能不同，分类可能落到 Other。
4. **ConPTY 集成测试**（Shell.Tests 10 条）依赖 conhost 正常的桌面会话；坏环境下预检软跳过（§11.10 机制在位）。
5. **中间提交不保证独立构建**：S4/S5/S6 为事后按阶段回填整理，跨阶段共享文件（服务层、MainWindow、design.md）随后续提交入库；**S6 提交（HEAD）= 已验证终态**（449 用例 + 两条 UIA 冒烟均在此树上通过）。
6. **性能数字为 Debug 构建本机实测**（100k 首屏 123ms / 下一页 120ms 等），Release 与其他硬件会有差异；预算（500/200ms）余量充足。
7. **fixtures 与真实仓库的差异**：测试 fixture 均为线性或简单分叉拓扑、单一作者（Fixture）；真实仓库的复杂拓扑（大量 merge、时区混杂、乱码提交消息）仅经 S3 渲染链路人工核查过，S4-S6 的逻辑测试未覆盖极端拓扑。

## 五、环境相关（本机 RDP 会话特有）

1. **WinUI 兼容性黑名单**：InfoBar fail-fast（已绕过，§11.15）；ConPTY 损坏（§11.10，软跳过）；MicaBackdrop 需 try/catch 兜底（§11.1）。桌面会话上可能均不复现——**S7 发布前需在干净 Windows 11 环境复测这三项**。
2. **Windows 事件日志**中留有 InfoBar 时代的 WER 崩溃记录（GitUI.App.exe，0xc000027b），属已修复问题，可忽略。

## 处置优先级建议（S7 输入）

| 优先级 | 项 |
|---|---|
| 高（发版前必修） | ~~1.1 部分暂存标记残留~~✅；~~1.7 复制完整输出~~✅；三（打包前）干净环境复测（待办） |
| 中（体验断层） | ~~1.2/1.3 仓库与分支状态联动~~✅；~~1.4 冲突解决最小闭环~~✅；~~1.8 transient 超时~~✅ |
| 低（可延后） | 1.5 多块选择；~~1.6 EOF 标志~~✅；2.1 过滤下推；2.2 接口拆分；其余 |

## 修复记录

### 2026-10-03 第一批（7 项：1.1 / 1.2 / 1.3 / 1.4 最小闭环 / 1.6 / 1.7 / 1.8）

- `ChangesViewModel`：提交成功/打开仓库清 `_partiallyStaged`；`ErrorDetail` + `SetError` 统一写入；`ClearTransient()`；`FileDiffView` 携带 EOF 标志。
- `BranchesViewModel`：`ErrorDetail` / `ClearTransient()` / `TransientMessage` / `BranchListChanged`（创建/重命名/删除后触发）。
- `RepositoryContext`：`BranchesChanged` 事件 + `NotifyBranchesChanged()`。
- `LogViewModel`：`RefreshBranchesAsync()`（不动提交与选中状态）。
- `UnifiedPatch.DetectEndOfNewline`；`DiffResult` 尾参 EOF 标志；`GetCommitDiff`/`GetFileDiff` 透出。
- ChangesPage：复制错误详情按钮、"在编辑器打开"按钮、冲突文件"标记已解决"动态标签、transient 5s 定时器、EOF 透传。
- BranchesPage：复制错误详情按钮、transient 5s 定时器、BranchListChanged → context 转发。
- LogPage：订阅 `context.Changed`（防回环）与 `context.BranchesChanged`（强制重建分支下拉）、EOF 透传。
- 验证：新增 `KnownIssuesFixTests`（8）+ `DiffEndOfNewlineTests`（7）；全量 453 用例绿；三条 UIA 冒烟（log/changes/branches）全过。

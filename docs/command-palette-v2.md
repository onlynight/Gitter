# 命令面板 v2 方案 —— Ctrl+P · 分类索引 · 最近使用

> 状态：已实施（2026-10-04，实施记录见 §九）
> 日期：2026-10-04
> 关联：design.md §4.6（S7 命令面板 v1）、§6.2（全局快捷键）
> 示意图：`design-mockups/ui-proposal-palette.png`（深色）· `ui-proposal-palette-light.png`（亮色）
> 网页原稿：`design-mockups/palette.html` / `palette-light.html`；主界面与控件亮色稿：`ui-proposal-log-light.png` / `ui-proposal-controls-light.png`

---

## 一、参考行为与定位

| 参考 | 吸收的行为 |
|---|---|
| VSCode | `Ctrl+Shift+P` 命令模式（输入框预填 `>`）；**输入分类名即过滤到该分类**（命令显示为"分类： 命令"）；最近使用置顶；行内高亮命中词；底部键位提示 |
| Sublime Text | `Ctrl+P` 万能入口；输入前缀切换模式；轻量、无按钮、纯键盘流 |
| JetBrains | 分类分组头；组头右侧计数 |

GitUI 的定位：`Ctrl+P` 与 `Ctrl+Shift+P` **都打开命令面板**（`Ctrl+P` 打开时输入框预填 `>` 进入命令模式，与现有快捷键兼容，标题栏 chip 不变）。

## 二、查询语法（核心设计）

| 输入 | 行为 |
|---|---|
| `（空）` | 全部命令，按 **最近使用（8条，置顶）→ 分类顺序** 排列，显示分类组头 |
| `分支` / 任意文本 | **命令标题 + 分类名同时**模糊匹配（FuzzyMatcher 现成）；命中的词在行内高亮；有命中的分类显示组头，组头右侧显示"命中 N" |
| `@分支` | `@` 前缀 = **仅按分类过滤**（分类头即索引入口，跳过标题匹配） |
| `@视图 主题` | 分类内再过滤（`@` 后余空格分隔 = 分类限定 + 标题词） |
| `>` | 命令模式标记，Ctrl+P 自动预填；纯兼容保留 |

## 三、命令清单（6 类 24 条）

| 分类 | 命令 | 快捷键 | 行为说明 |
|---|---|---|---|
| **最近使用** | 动态，最多 8 条 | — | 持久化到 settings.json `recentCommands`，空查询时置顶组 |
| **导航** | 转到项目 / Log / 变更 / 分支 / 终端 / 设置 | Ctrl+1..6 | 现有 6 条保留 |
| **仓库** | 刷新当前页 | F5 | 现有 |
| | 新建窗口 | — | 现有 |
| | 切换项目 | — | 新增：跳转项目页（等价"转到项目"） |
| **提交** | 提交 | Ctrl+Enter | 新增：直达 Changes 页并执行（未开仓库时置灰） |
| | 提交并推送 | — | 同上 |
| | 全部暂存 / 全部撤销暂存 | — | 新增（Changes 已有组级动作，提为全局命令） |
| **分支** | 检出选中分支 / 创建分支… / 重命名 / 删除 / 合并到当前分支 / 变基到该分支 / 快进 | 创建=Ctrl+Shift+N | 新增：选中分支取当前页选中项；分支页未打开或无选中时置灰 |
| **同步** | Pull / Pull Rebase / Push | — | 新增（Branches 已有按钮动作） |
| **视图** | Diff 并排 / Diff 内联 | — | 现有，归入"视图" |
| | 主题：跟随系统 / 浅色 / 深色 | — | 现有，归入"视图" |
| **设置** | 导出设置 / 导入设置 | — | 现有 |

"常用"的来源就是这份清单——把**现在埋在页面按钮里的高频动作（提交/暂存/Pull/Push/检出）提为全局命令**，符合"打开即用、无需记按钮位置"。

## 四、交互规格

- **键盘**：`↑↓` 移动选择并**自动跳过分类组头**（组头不可选）；`Enter` 执行选中项；`Esc` 关闭；`Home/End` 首尾；输入即过滤，防抖 120ms
- **鼠标**：悬停高亮；**单击即执行**（VSCode 式——顺带修复现有面板"双击无响应"的缺陷）；点击组头 = 把组名填入输入框（等价 `@组名`）
- **选择默认**：打开时选中"最近使用"第一条（无记录则第一条命令）；过滤后选中首个命中
- **空态**：无命中显示"没有匹配的命令（Esc 关闭）"
- **执行后**：面板关闭 + 命令记入最近使用（去重置顶，超 8 删尾）
- **UIA**：面板输入 `AutomationProperties.Name` 保持"输入命令…"（冒烟依赖）；组头 `Name="分类 导航"`、命令项 `Name="命令标题"` 不变格式

## 五、视觉规格（沿用已落地的 IDE 令牌）

- 面板：panel 底 `#2B2D30`、1px `#43454A` 边框、6px 圆角、大阴影；宽 460px
- 输入行 34px：`>` 命令模式标记（accent 色、mono）+ 光标 + 右侧 `Ctrl+P` kbd
- 命令行 28px：`[图标] 标题 ......... kbd`；命中词 accent 20% 底色高亮；悬停 hover 色；选中行 = selected 底 + 左侧 2px accent 条
- 分类组头 24px：base 底、11px 半粗 `#6F737A` 字、右侧 mono 计数
- 底栏 26px：`↑↓ 选择 · ↵ 执行 · Esc 关闭`，右侧 `@分类名 直接索引` 提示

### 亮色映射（与深色同权的第一主题）

结构不变，令牌按 `ThemeStyles.xaml` Light 字典映射：

| 令牌 | 深色 | 亮色 |
|---|---|---|
| base（内容底） | `#1E1F22` | `#FFFFFF` |
| panel（面板/弹层底） | `#2B2D30` | `#F7F8FA` |
| hover / selected | `#393B40` / `#43454A` | `#EBECF0` / `#E0E2E8` |
| 边框 弱 / 强 | `#2E3033` / `#43454A` | `#E6E7EA` / `#D5D7DB` |
| 强调色 | `#3574F0` | `#2B6BE4`（浅底上加深保证对比度） |
| 文字 主 / 次 / 弱 | `#DFE1E5` / `#9DA0A8` / `#6F737A` | `#1F2328` / `#5C6167` / `#8A8E94` |
| 语义 绿 / 红 | `#6FBF73` / `#F75464` | `#1A7F37` / `#CF222E` |
| 命中高亮底 | accent 33% | accent 20% |
| 阴影 | `0 16px 48px #00000080` | `0 12px 32px #1F293726`（更轻） |

要点：亮色弹层 = 实色白 + 轻阴影；kbd 键帽边框用 `--border-strong`；组头底色用 base（白）在 panel（浅灰）上形成分段。

## 六、技术实现映射

| 改动点 | 内容 |
|---|---|
| `MainWindow.xaml.cs` | `CommandItem` 扩展为 `(Category, Title, KeyHint, Action)`；`BuildCommands()` 重写为分类清单（约 24 条，部分命令经页面缓存对象调用并按可用性置灰）；新增 `Ctrl+P` accelerator（与 `Ctrl+Shift+P` 同入口） |
| `FilterPalette` 重写 | 解析 `@`/`>` 前缀 → 组装 `List<(bool isHeader, CommandItem?)>`；标题+分类双字段 FuzzyMatcher 打分，`@` 时只匹配分类；ListView 数据带组头占位行（Tag="header" 不可选中、跳过） |
| 选择移动逻辑 | `↑↓` 跳过 Tag=header 的项（现有 SelectedIndex±1 改为找相邻非 header 项） |
| 执行交互 | `ListView.ItemClick`（单击执行）替换 `DoubleTapped`；执行后写最近使用 |
| `AppSettings` | 新增 `RecentCommands (List<string>, ≤8)`，命令标题作 key |
| UIA 冒烟 | `smoke-command-palette` 预期需两处更新：Ctrl+3→Ctrl+4（项目页加入后分支快捷键顺延）+ 单击执行后"面板已关闭"断言方式 |

## 七、验收标准

1. `Ctrl+P` / `Ctrl+Shift+P` / 标题栏 chip 三个入口都能打开面板
2. 空查询显示"最近使用 + 全部分类组头"；输入 `分支` 只剩导航+分支两组且命中词高亮；输入 `@视图` 只剩视图组
3. `↑↓` 不落在组头上；Enter 执行；Esc 关闭；单击执行
4. 执行过的命令出现在下次打开的"最近使用"顶部，重启应用仍保留
5. 全部 24 条命令可执行且置灰逻辑正确（未开仓库时提交/同步类置灰）
6. 三页冒烟 + 命令面板冒烟通过（面板冒烟预期按第四节更新）

## 八、工作量

约 **0.5–1 天**：`FilterPalette`/选择逻辑重写 + 命令清单扩展为主工作量（约 200 行 C#），`AppSettings` 加一个字段，UI 更新（组头/底栏/单击执行）约 100 行。

风险低：不改 TextBox / ComboBox 控件模板，不碰 ThemeStyles 资源解析层（2026-10-04 IDE 风格重构中该层曾因模板资源缺失触发 0xC000027B，见 git 历史）；唯一注意点是面板列表单项 UIA Name 保持现有格式。

## 九、实施记录（2026-10-04）

按 §三 表格全量落地，共 **6 类 30 条命令**（§三标题的"24 条"为估算）。验收 1–6 全部满足：三入口打开、`@`/文本双模式过滤、组头跳过、单击执行、最近使用持久化（settings.json `recentCommands`）、全部冒烟通过。

与方案的差异（均为实施中发现的技术约束）：

1. **行容器不用 ListView**：`ItemClick` 在 `SelectionMode.Single` 下不保证触发（冒烟实测），且 `ListViewItem` 不支持 UIA `InvokePattern`。改为 `ScrollViewer + StackPanel`，**组头与命令行都是 Button**（仓库惯例：ChangesPage/ProjectsPage 行同款）——真实单击走 `Click`，冒烟走 `InvokePattern`，同一路径。
2. **UIA Name 格式**：组头 = Button `"分类 导航"`；命令行 = Button **纯标题**（快捷键在行尾 kbd 芯片，不进 Name）；输入框 Edit `"输入命令…"`。冒烟相应从 `'转到分支 (Ctrl+3)'`（含物理双击）改为 `'转到分支'` + InvokePattern。物理鼠标/键盘注入在当前会话不可靠（前台窗口=0），全部 UIA Pattern 驱动。
3. **命中词高亮**：WinUI 的 `Run` 无 `Background`，改用 前缀 TextBlock + `AccentSoft` Border 包裹命中词 + 后缀 TextBlock 三段拼装（仅连续子串命中时高亮）。
4. **滚动**：WinAppSDK 2.3 无 `StartBringIntoView`，键盘选择用 `TransformToVisual` + `ChangeView` 手动滚动。
5. **防抖 120ms**：`DispatcherQueueTimer`，UIA `ValuePattern.SetValue` 会触发 TextChanged，冒烟兼容。
6. **可用性求值**：提交/同步类 = `_repoContext.WorkDir is not null`；分支操作类 = 分支页已打开且 `HasSelectedLocalBranch`。页面动作经缓存页对象的新公开入口（`CommitFromPalette` / `PullFromPalette` / `CheckoutSelectedFromPalette` / `CreateBranchFromPaletteAsync` 等），对话框加 `DialogXamlRoot` 兜底（面板先跳页再弹框时 `XamlRoot` 可能尚未传播）。
7. **新快捷键**：`Ctrl+P`（预填 `>`）、`Ctrl+Shift+N`（创建分支）。`Ctrl+Enter` 仅作提示不挂全局 accelerator——ChangesPage 提交框已有同名 KeyDown 处理，避免双重提交。
8. 视觉偏差：Popup 未做大阴影（ThemeShadow 接入成本高、0xC000027B 风险区），其余按 §五 落地。
9. **亮色支持（2026-10-04 补充设计稿）**：亮色设计稿三张（主界面 / 控件状态 / 命令面板，`ui-proposal-*-light.png`）。面板配色经 `Ui.Panel/BorderStrong/Text*` 动态取值随主题切换；实现时需自查无写死深色处，并修复已知问题"主题=浅色启动不生效"（settings.json theme=1 启动仍渲染深色）。

新增/改动：`AppSettings.RecentCommands`（Normalize 去空/去重/≤8）+ 2 个单测；`BuildCommands()` 分类清单；`FilterPalette`/选择/执行逻辑重写；`smoke-command-palette.ps1` 重写为 UIA Invoke 驱动并新增"组头/最近使用持久化"断言。

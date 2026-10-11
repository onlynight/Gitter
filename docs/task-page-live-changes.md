# 任务页实时变更面板（v3.1）— 技术方案

> 设计稿：`design/task-page-v3-mockup.html`（分栏态）、`design/settings-plugins-mockup.html`（插件挂载树）
> 关联：检查点机制（`app/src/services/agents/checkpoint.ts`）、v3 任务页重构（本轮已完成）

## 1. 背景与目标

agent 执行过程中的修改当前必须切到「改动」页签才能看到，反馈链路断。目标（对齐 ZCode/Codex）：

- 对话页分栏：**对话 4/7 + 实时变更面板 3/7**，面板随执行实时刷新
- 变更面板支持**按轮（checkpoint）查看每一轮的修改代码**
- 文件可**预览（文本/图片）**、可在**内置编辑器（Monaco，默认选中）编辑**，也可**选外部应用**打开
- 现有「改动」「检查点」页签**保留不动**；面板只是把这两个页签的数据源搬进对话现场
- 面板与任务页各扩展点**插件化**，在 设置 → 扩展 → 插件挂载树 可见、可开关

## 2. 交互总览

```
┌─ pagehead（状态药丸/分支/排队/新窗口）─────────────────────────────┐
├──────────────────────────────┬───────────────────────────────────┤
│ 对话流（现有，不动）            │ 变更面板 LiveChangesPanel          │
│                              │ ┌ 轮次: [全部(基线)] [7f3a2c1] …  │
│  用户消息 / 工具卡 / 授权卡 /…  │ ├ 文件列表 A/M/D + ±（点击选中）     │
│                              │ ├ 查看条: 路径 [编辑|差异] [外部应用] │
│  composer                    │ │        [保存(编辑态)]            │
│                              │ └ 内容区: Monaco / DiffView / 图片  │
└──────────────────────────────┴───────────────────────────────────┘
```

- **分栏**：仅 `tab === "chat" && selected` 时生效；`收起` 按钮 → 纯对话，右上角出现「变更面板」恢复药丸；**两条分割线均可拖拽**——任务列表|对话（宽度持久化 `settings.taskListWidth`）、对话|面板（比例持久化 `settings.taskSplitRatio`，默认 4/7）；面板与对话窗口顶部齐平、占满全高
- **按轮 tab 查看（不展示累计全部）**：面板顶部为轮次 tab 条——`最新一轮`（工作区当前内容，可编辑）+ 已打开的历史轮 tab（`cp <sha> ×`，可关闭）；点击「＋ 轮次」打开其他轮次；每个 tab 独立展示该轮文件列表与变更内容
- **右侧 = 主预览面**：对话流里一切「查看 / 预览」动作（文件变更行的 查看/预览、工具卡的 预览、错误浮层等）**一律驱动右侧面板**——`查看` = 选中该文件并切「差异」视图，`预览` = 选中该文件并切「编辑/预览」视图；面板若收起则自动展开。不再开 Modal、不再跳改动页（Modal 预览仅保留给面板外无分栏场景的降级）
- **文件视图**：文本文件默认 **编辑**（内置 Monaco，可写回）；可切 **差异**（DiffView）；图片直接内联渲染（`file.readBinary`）；任意文件可 **外部应用** 打开

## 3. 布局与状态管理（TasksPage.tsx）

```
<div className="main">                     ← App.tsx
  <左：任务列表（v3 已完成）/>
  <右：detail>
    <tk-tabs/>
    {tab === "chat" && (
      <div className="tk-split" style={{ gridTemplateColumns: `minmax(0,${4})fr minmax(280px,${3})fr` }}>
        <对话列：pagehead + stream + composer（现有结构平移）/ >
        {panelOpen && <LiveChangesPanel taskId scope onCollapse />}
      </div>
    )}
```

- **不重挂载**：对话列的 timeline / 滚动位置 / composer 状态不能因分栏开关丢失——分栏只是外层 grid 换 `grid-template-columns`，面板挂卸不触碰对话子树（对话页现有“保持挂载”策略平移）
- **比例拖拽**：分隔条 `pointerdown` 挂临时 transition（复用侧栏教训：常驻过渡会让 grid 轨道卡死）→ `pointermove` 写 `gridTemplateColumns` → `pointerup` 落 `settings.taskSplitRatio` 并摘过渡；`Esc` 取消拖拽
- **窄窗口降级**：`detail` 宽 < 1100px 自动收起面板（CSS 容器查询或 resize 监听），药丸恢复
- **选中态联动（主预览面）**：对话流的一切 查看/预览 动作统一走 `lsGoto(path, mode)` 驱动面板——文件变更行的 查看/预览、工具卡（file_write/file_patch）头部的 预览、pendingFile 机制全部改为指向面板；面板收起时自动展开；`tasks.previewFile` Modal 仅保留为面板不可用时的降级路径

## 4. 数据与 RPC（全部复用既有面，零新增后端）

| 数据 | RPC | 说明 |
|---|---|---|
| 轮次列表 | `agent.task.checkpoints` | 现有；建议顺带加 `--numstat`（之前批准的遗留项）供轮次 chip 显示 ±统计 |
| 文件列表 | `agent.task.files` / `agent.task.diff` | `since: checkpoint:<sha>` 已支持按轮；`agent.task.diffText` 供复制 |
| 文本内容 | `file.content`（revision: worktree） | 有 `maxBytes` 限流：超限 → 只读降级提示「文件过大，用外部应用打开」 |
| 保存 | `file.write`（含 eol 保持） | 与文件页编辑器同一条保存链（`refreshReadLogFor` 防 agent mtime 误拒需同步调用） |
| 图片 | `file.readBinary`（base64） | `<img src="data:...">`；上限沿用现有 4MB 级约束 |
| 外部应用 | `shell.openPath { editor: true }` | 已实现：`settings.externalEditor` 配置了走配置编辑器，否则系统默认应用；设置 → 终端/文件里已有该配置项 |
| 实时刷新 | `file-change` / `checkpoint` 事件 | 现有 `changesTick` 机制面板共用；执行中每次文件变更徽标 +1 并增量刷新列表 |

**建议新增（小）**：`agent.task.diff` 在 `since=checkpoint:` 下已可按轮；`file-change` 事件目前只有 path/kind/summary——面板实时插入行需要 ±统计时可接受 summary（现有），不新增 RPC。

## 5. LiveChangesPanel 组件设计

`web/src/pages/TaskChangesPanel.tsx`（新文件，任务页私有）：

```
props: { taskId, scope, onScope, onCollapse, splitRatio }
state: files: AgentTaskFileDTO[], sel: string | null, viewMode: "edit" | "diff", content, dirty
```

- **数据 hook** `useTaskChanges(taskId, scope)`：scope = "all" | checkpoint sha；组合 `checkpoints` + `files`/`diff`；`changesTick` 触发重拉；文件列表渲染复用 `.df` 行卡语言（A/M/D + mono 路径 + ±）
- **编辑器**：复用 `FilesMonacoEditor`（model 由调用方 `createTextModel` 持有）。**懒加载**：Monaco 目前随文件页 chunk——面板用 `React.lazy(() => import("../pages/FilesMonacoEditor"))` + Suspense，避免任务页首载拉 Monaco
- **编辑语义（红线）**：编辑器永远编辑**当前工作区**内容；`scope` 为历史轮时 Monaco **readOnly** + 顶部提示「历史轮为只读回看，编辑请切到全部(基线)」——避免“在历史轮视图里改文件却改的是当前版本”的语义陷阱。保存 = `file.write`（仅全部/最新轮可写）
- **图片**：`changeKind`/扩展名（png/jpg/webp/gif/svg）→ `file.readBinary` → data URL 内联；图片无编辑/差异 seg（段控件隐藏，同设计稿）
- **外部应用**：`shell.openPath { path: worktreePath + "/" + rel, editor: true }`；未配置 `externalEditor` 时即系统默认应用——与设置项天然联动

## 6. 插件化与设置可见性

注册面（渲染层注册表，`registerAgentUI`）扩展一个槽位：

```ts
registerAgentUI({
  timelineRenderers: [...],      // 已有
  composerProviders: [...],      // 已有
  taskPanels: [{ id, title, render: (ctx) => ReactNode, defaultEnabled: true }],  // 新增：任务页分栏面板
});
```

- 内置面板即第一个 `taskPanels` 贡献（`id: "builtin.live-changes"`）；`defaultEnabled: false` 的插件面板渲染为面板头部的**附加标签页**（与「变更」并列），不满足时自动隐藏
- **设置可见性**：设置 → 扩展 → 插件挂载树（已存在的渲染层注册表快照）增加「任务页」分支，按槽位列出：时间线渲染器 / Composer 提供者 / 斜杠命令 / **分栏变更面板**，每行 = 贡献名 + 来源（内置/包 id）+ 启用开关；开关走既有 `extensions.setKindEnabled` / `setConfig`，热插拔经 `extensions.changed` 事件即时生效（设计稿 `design/settings-plugins-mockup.html`）
- 外部包贡献途径与 timelineRenderers 相同（包 manifest 的 agent UI 声明），无需新协议

## 7. 兼容与降级

| 场景 | 行为 |
|---|---|
| 改动页 / 检查点页 | 原样保留；面板本质是它们的数据源嵌入对话现场 |
| 未选中任务 / 新任务 composer | 不分栏（现有居中 composer 形态） |
| 窄窗口 < 1100px | 自动收起面板，恢复药丸 |
| 文件过大（> file.content maxBytes） | 只读降级 + 外部应用引导 |
| 二进制/图片 | 图片内联；其他二进制 → 外部应用 |
| 无 checkpoint（首轮执行中） | 轮次 scope 只有「全部(基线)」；checkpoint 事件到达即时补 chip |
| 历史轮编辑 | readOnly + 提示（§5 红线） |

## 8. 分期落地

| 阶段 | 内容 | 量级 |
|---|---|---|
| P1 | 分栏布局 + LiveChangesPanel 只读（文件列表 + DiffView 预览 + 图片 + 外部应用）+ 收起 | 前端 ~600 行，零后端 |
| P2 | 内置编辑器编辑 + 保存链（Monaco 懒加载、dirty/Ctrl+S、历史轮只读红线） | 前端 ~300 行 |
| P3 | 插件化 taskPanels 面 + 设置挂载树「任务页」分支 + 检查点 numstat（遗留） | 前后端各 ~150 行 |
| P4 | 两条分割线拖拽（任务列表宽度 + 分栏比例，`taskListWidth`/`taskSplitRatio` 持久化）+ 轮次 tab 化 + 窄窗口降级打磨 | 前端 ~180 行 |

## 9. 风险与红线

1. **常驻过渡红线**：分栏比例动画只允许在拖拽会话内挂过渡（同侧栏 `.main-anim` 教训）
2. **对话子树不可重挂载**：分栏开关/比例变化不得触发 timeline 重挂（滚动位置、输入态都会丢）
3. **保存竞态**：agent 正在写同一文件时保存 → 沿用文件页的 mtime 校验链（`refreshReadLogFor`），冲突时提示重载
4. **Monaco 体积**：必须懒加载；任务页首屏不拉 Monaco chunk
5. **大 diff**：面板内 DiffView 沿用 >600 行虚拟化，不自绘

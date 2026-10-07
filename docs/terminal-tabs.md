# 终端页多标签设计（Windows Terminal 交互形式）

> 状态：设计提案 v1.0（2026-10-08）。**仅设计稿，未动代码。**
> 参考：Windows Terminal 的标签交互（标签条 + +新建 + 下拉选配置文件 + ×关闭 + Ctrl+Tab 切换）。
> 前置：终端容器已有圆角框（term-wrap）；标签条嵌入框内顶部，与框一体。

## 一、交互规格

```
┌─ [ 圆角框（term-wrap）]──────────────────────────────────────┐
│ [● PowerShell ×] [ CMD ×] [ Git Bash ×]        [ ＋ ][ ⌄ ]   │  ← 标签条（框内顶部）
├──────────────────────────────────────────────────────────────┤
│  PS D:\Code\Gitter> █                                        │  ← 终端（仅激活标签）
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ Ctrl+Shift+C 复制 · Ctrl+Shift+V 粘贴                        │  ← 状态行（原有）
└──────────────────────────────────────────────────────────────┘
```

| 交互 | 行为 |
|---|---|
| 点击标签 | 切换激活标签（xterm 实例切换显示，会话保持后台运行） |
| ＋ 按钮 | 以**默认配置文件**（settings.terminalShell）新建标签并激活 |
| ⌄ 下拉箭头 | 弹出**配置文件菜单**：PowerShell / CMD / Git Bash——点击即以该配置新建标签（覆盖默认） |
| 标签 × | 关闭该标签：杀掉对应 pty 会话；若命令在运行（running 且 exitCode=null）弹确认 |
| 中键点击标签 | 同 ×（直接关闭，不确认——WT 惯例） |
| Ctrl+Tab / Ctrl+Shift+Tab | 循环切换下一个/上一个标签（终端页聚焦时） |
| 双击标签空白处 | 新建默认标签（WT 惯例，可选实现） |
| 标签溢出 | 标签条横向滚动（不缩窄标签），滚轮悬停于标签条时可横向滚动 |

不做（本期）：标签拖拽排序、标签重命名、分屏（pane splitting）、每标签独立主题。

## 二、状态模型

### 渲染层（TerminalPage）

```ts
interface TermTab {
  sessionId: string;      // 主进程会话 id（terminal.list 恢复的锚点）
  shellKind: string;      // powershell | cmd | bash（决定标签标题与图标）
  title: string;          // PowerShell / CMD / Git Bash（后续可含 cwd 尾段）
}
const [tabs, setTabs] = useState<TermTab[]>([]);
const [activeId, setActiveId] = useState<string | null>(null);
// xterm 实例表：sessionId → { term, fitAddon }（懒创建：首次激活时 open+fit）
const terms = useRef(new Map<string, { term: Terminal; fit: FitAddon }>());
```

- **激活切换**：旧的 `term.element` 保留在隐藏容器中（display:none 切换，不销毁）——切回时 `fit()` 重排即可，输出零丢失；
- **输出路由**：`terminal.data` 事件本就带会话 id——只写入对应标签的 xterm（隐藏标签也写入，保证后台任务输出不丢，切回即见完整历史）；
- **页面重挂载恢复**（切页再切回 / 窗口刷新后重启会话丢失除外）：挂载时 `terminal.list()` → 为每个 running 会话重建标签与 xterm（scrollback 由 pty 侧不可恢复，仅恢复活跃视图——与现状单会话一致）。

### 主进程（TerminalManager 小改）

| 项 | 现状 | 改动 |
|---|---|---|
| ensure 复用逻辑 | 找"第一个 running 且匹配"的会话复用/杀死 | 增加可选 `sessionId`：有则**按 id 定位**（存在且 running → 直接返回；不存在 → 新建该 id）；无 sessionId 时保持旧行为（单会话兼容） |
| close RPC | 无（kill 仅内部） | 新增 `terminal.close { id }`：杀 pty、移除会话 |
| list | 已有 | 不变（标签恢复数据源） |
| write/resize/data 事件 | 已按 id 寻址 | 不变 |

> 多 pty 并发：node-pty 天然支持；sessions Map 本就是多会话结构，ensure 是唯一"单会话假设"。

## 三、UI 细节（对齐现有设计语言）

- **标签条**：位于圆角框内顶部，高 34px，底色 = 框底（材质上的一层），右端 [＋][⌄] 两个幽灵按钮（无边框、hover 圆角底，同下拉框触发器语言）；
- **标签**：高 26px、圆角 6px、左右内衬 10px；**激活** = 框内容底色（比标签条亮一档，与内容区同色，"凸出"感）+ 文字 --c-text；**非激活** = 透明 + 文字 --c-text3；hover = --c-hover 圆角底；× 仅 hover 时显现（激活标签常显）；
- **⌄ 菜单**：复用右键菜单视觉（实底悬浮层规则已覆盖 .ctxmenu 同族——新类 `.profile-menu` 加入同一悬浮层规则）；每项 = 配置文件名 + 新建图标；
- **暗/亮主题**：全部走令牌（--c-base/--c-panel2/--c-hover/--c-border），磨砂材质下标签条与框同透、弹层实底——与全窗规则一致；
- **终端内容层**：xterm 区域维持在框内 padding 6px 10px 不变。

## 四、需要澄清/默认裁决的点

1. **×关闭运行中命令**：默认弹确认（"命令仍在运行，确定关闭？"）；设置项不加（WT 也不加）；
2. **标签标题**：v1 用配置文件名（PowerShell/CMD/Git Bash）；带 cwd 尾段（如 `PowerShell · Gitter`）留到后续；
3. **新标签默认 cwd**：跟随仓库（terminalFollowRepo 语义）——与首标签一致；
4. **最后一片标签关闭**：显示空态（"＋ 打开新终端"引导），页面不退回其他页；
5. **会话上限**：不设硬上限（pty 资源自然约束）；>10 时标签条滚动。

## 五、改动清单（实施范围）

| 层 | 文件 | 改动 |
|---|---|---|
| 主进程 | services/terminal.ts | ensure 增 sessionId 定位；新增 close() |
| 主进程 | bridge.ts | terminal.close RPC；ensure 参数透传 sessionId |
| 渲染层 | pages/TerminalPage.tsx | 标签条 UI + 多标签状态 + xterm 实例表 + 快捷键 |
| 样式 | styles.css | .term-tabs/.term-tab/.profile-menu 样式（走令牌） |
| 类型 | shared/types.ts | 无破坏（TerminalSessionDTO 已足够） |

估计规模：主进程 ~40 行、渲染层 ~250 行、样式 ~60 行。

## 六、验收清单

1. ＋ 新建 → 新 pty 会话、标签激活、旧标签会话保持后台运行；
2. ⌄ 菜单选 CMD → 新建 CMD 标签；
3. 切换标签 → 输出无丢失、fit 正确（无错位）；
4. × 关闭 → pty 终止（terminal.list 不再返回）、运行中弹确认；
5. 切页再回 → 标签与会话恢复；
6. Ctrl+Tab 循环切换；
7. 亮/暗、三种材质下标签条视觉正确（磨砂下标签条同透、弹层实底）。

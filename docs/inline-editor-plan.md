# 内建代码编辑器技术方案（Monaco + 项目文件树）

> 状态：设计稿（Phase 1 待启动）
> 关联：`winui3-to-web-migration.md` §P5 Monaco 取舍、`ui-full-pluginization-plan.md` 页面包链路、`code-highlight-framework.md` 高亮管线

---

## 0. 决策摘要

**做什么**：在 Gitter 内加一个「项目文件树 + 代码编辑」页面（新槽位 `files`），让用户能在 Gitter 里手动改代码，不用跳到 VS Code。

**不做什么**：
- 不兼容 VS Code 插件（`.vsix`）——那是 VS Code 宿主的能力，不属于 Monaco。
- 不替换现有 `DiffView.tsx`（验收台核心，已 342 行且 hunk 勾选/字级 diff 定制成本高）。
- 不改服务端高亮框架（`highlight.file` 继续服务只读预览）。
- 不动 agent 写工具的主契约（`file_write`/`file_patch` 护栏保留）。

**取舍记录**：
- 上一版设计文档 `winui3-to-web-migration.md:215` 明确「Monaco 默认不引入，约 +5MB 包体」。本方案推翻该决策，理由：原决策是"提交消息编辑器 + 只读预览窗"的轻量场景，本方案是"手动改代码"的完整场景，能力缺位明确。
- **智能提示/补全：引入**（P2 复核推翻了"不做补全"的保守档）——用 Monaco 内置语言服务（json/css/html/typescript worker 随包内联，§2.3），开箱覆盖 TS/JS/JSON/CSS/HTML，不依赖外部进程；其余语言的 LSP 通道保留为 P3+ 可选（§4.5）。
- 保留外置 VS Code 接力作为复杂重构的逃生舱（`file.openInEditor` 命令已存在，`commands.ts:78`），两者互补。

---

## 1. 总体架构

```
┌─ 侧边栏（uiRegistry 驱动）
│   Projects · Log · Changes · Branches · Tasks · Terminal
│   Files (新增, order=70) · Settings
│
├─ PageOutlet (keep-alive)
│   └─ gitui.page.files  (新增页面包)
│       └─ SplitPane (左右分栏 35/65)
│           ├─ 左：TreePane
│           │   ├─ git 状态层 (FileStatusDTO 索引)
│           │   └─ agent 回合层 (agent.task.files 索引)
│           └─ 右：EditorPane
│               └─ Monaco Editor × N (keep-alive, 多标签)
│
└─ 底部（可选）：DiffView (复用现有, 用于查看 agent 改动/提交预览)
```

**为什么走页面包链路**：`builtinPages.ts` + `uiRegistry.ts` 已把「侧栏可见性、Ctrl+1..9 快捷键、PageOutlet keep-alive」全部抽象为注册表驱动。加槽位 = 一行元数据 + 一个 IIFE 入口文件，不动 `App.tsx`。

**为什么不做成 Changes 页子面板**：Changes 页职责是「提交」（选 hunk → stage → commit），编辑器是「改」，语义不同。且 Changes 页 `SplitPane` 已占用。

---

## 2. 新增页面槽位

### 2.1 注册表登记

`web/src/builtinPages.ts` 新增一条：

```typescript
registerBuiltinPages([
  // ...现有
  { id: "files", titleKey: "Nav_Files", glyph: "\uE8A5", order: 70 },
]);
```

`order: 70` 插在 terminal(60) 和 settings(700) 之间。`glyph: "\uE8A5"` 是 Segoe Fluent 文件图标。

### 2.2 页面包结构

照 `gitui.page.bash` 同款链路：

```
app/resources/packages/gitui.page.files/
├── manifest.json         (contributes.pages, permissions: ["git.read","git.write","window"])
├── page.js               (vite 构建产物, IIFE 经典脚本)
├── i18n/
│   └── zh-Hans.json      (Nav_Files, Files_Title, Files_Empty, Files_Saved, ...)
└── docs/
    └── zh-Hans.md        (可选, 用户手册)
```

**权限域分析**：
- `git.read` — 读 `repo.tree`、`file.content`、`repo.status`、`agent.task.files`、`highlight.file`（`open` 域是默认子集）
- `git.write` — 编辑器保存走 `file.write`（写护栏）
- `window` — 右键菜单调 `shell.openPath`（外置接力逃生舱）

### 2.3 构建链路

`web/scripts/build-pages.mjs` 的 `PAGES` 数组加 `"files"`。

**Monaco 处理决策：作为页面私有依赖，不 external。**

理由：
1. Monaco 不是 React 单例，不需要走 `window.GITTER_KIT` 共享。
2. Monaco 自带 worker 体系，必须用 `?worker` 后缀加载，Vite 有特殊处理。
3. Monaco 有自己的 CSS（`monaco-editor/min/vs/editor/editor.main.css`），独立于宿主样式。

预计产物大小：Monaco 核心 + TS/JS/JSON 语言包 ≈ 3.5–4 MB（未压缩，`minify: false` 保持既有策略）。比 bash 页 506 KB 大 7 倍，总计页面包 ~920 KB → ~4.9 MB（增长 5 倍，量级对齐）。

**worker 处理**：file:// + webSecurity 下 `new Worker(相对 URL)` 被同源策略拦截，必须让 Vite 把 worker 编译为 base64 内联、运行期经 Blob URL 构造：

```typescript
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker&inline";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker&inline";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker&inline";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker&inline";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker&inline";

self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case "json": return new jsonWorker();
      case "css": return new cssWorker();
      case "html": return new htmlWorker();
      case "typescript":
      case "javascript": return new tsWorker();
      default: return new editorWorker();
    }
  },
};
```

**实现要点（P2 实测沉淀）**：
- 后缀必须是 `?worker&inline`（而非 `?worker`）：后者即使配了 `worker: { format: "iife" }` 也会把 worker 以独立文件产出（assets/*.worker-*.js，实测 ~16MB 死重，页装载器不装载）；`&inline` 强制只走 base64 + Blob URL。构建配置需 `worker: { format: "iife" }`（build-pages.mjs）。
- CSS 分发：Monaco ESM 经 96 个 `import './x.css'` 分发样式，lib IIFE 构建下 vite 会把 CSS 抽成独立产物而页装载器只装 page.js——build-pages.mjs 的 `monaco-css-inline` 插件把这些 .css 重写为「自注入 `<style>`」的 JS 模块，codicon.ttf 等字体内联为 data URI。
- alias 陷阱：build-pages.mjs 的 `"../commands"` 字符串前缀 alias 会误伤 monaco 内部 `'../commands/replaceCommand.js'` 形态的相对导入——三个 shim alias 已改为 `^\.\./xxx$` 精确正则。

---

## 3. 新增 RPC

### 3.1 `repo.tree` — 文件树骨架

**位置**：`app/src/bridge.ts` 注册，`app/src/services/treex.ts` 实现。

**Schema**：
```typescript
// 请求
{ prefix: string; depth: number }
// 返回
{
  entries: TreeEntry[];
  hasMore: boolean;
}

interface TreeEntry {
  path: string;
  isDir: boolean;
  /** git 状态码 (M/A/D/R/U/?)；null = 未改动 */
  status: string | null;
  /** 是否被 agent 本回合碰过 */
  touchedByAgent: boolean;
}
```

**实现要点**：
- 一次性拿全量（`git ls-files -co --exclude-standard` 已过滤 `.gitignore`）。
- 中型仓库（<10 万文件）单次调用 <50ms，全量返回让前端一次性构树、自由展开折叠，比按层级懒拉更简单。
- 叠加 git 状态：直接消费 `getStatus()` 已解析好的 `FileStatusDTO` 索引，不重写解析。
- 前端用 `@tanstack/react-virtual`（web 已依赖）做虚拟化渲染。

### 3.2 `file.content` — 文本内容读取

**位置**：`app/src/bridge.ts` 注册，复用 `app/src/services/fsx.ts` 的路径锁。

**Schema**：
```typescript
// 请求
{ path: string; revision?: "worktree" | "index" | string; maxBytes?: number }
// 返回
{
  content: string;
  encoding: "utf8";
  eol: "crlf" | "lf";
  size: number;
  mtime: number;
  binary: boolean;
  truncated: boolean;
  revision: string;
}
```

**关键决策**：
1. **不设 64K 字符 cap**（区别于 `agent.task.previewFile`，那是给 agent 上下文用的）。预览/编辑场景需要完整内容，8 MB 上限。
2. **返回 `mtime`**：编辑器用它做冲突检测（打开后文件被改过就警告）。
3. **返回 `eol`**：编辑器保存时必须保留原行尾，否则 `git diff` 会显示整文件改动。
4. **二进制嗅探**：NUL 字节检查，命中则 `binary: true` 不出内容，UI 降级为图片预览或「不支持」。
5. **`revision` 支持三种**：`"worktree"`（默认，工作区）、`"index"`（暂存区）、40 位 sha（历史版本）。

### 3.3 `file.write` — 编辑器保存

**位置**：复用 `file_write` 工具的实现，但**不暴露为 agent 工具**，仅暴露为 RPC。

**关键**：编辑器保存走 `file_write` 的护栏（路径锁、2 MB 写入护栏），但**不走 readLog 校验**——因为编辑器自己就是读文件的一方，刚读过就写，不需要「先读再写」的校验（那是防 agent 踩用户改动的）。

**Schema**：
```typescript
{ path: string; content: string; eol?: "crlf" | "lf" }
// 返回
{ ok: true; size: number; mtime: number }
// 或
{ ok: false; error: "size_limit" | "path_locked" | "binary" }
```

**写后刷新**：写成功后立即更新 `env.readLog` 的 mtime 记录，让 agent 的下一个 `file_patch` 能通过校验。

### 3.4 `agent.task.files` — agent 回合文件索引

已存在（`bridge.ts:438-455`），返回本回合 agent 改动的文件列表。前端用它的 path 集合在树上做 `touchedByAgent` 高亮。

---

## 4. 前端组件

### 4.1 页面入口

`web/src/pages/entries/files.ts`：

```typescript
import React from "react";
import { createRoot } from "react-dom/client";
import { FilesPage } from "./FilesPage";

export default function mount(container: HTMLElement, pageCtx: any) {
  const root = createRoot(container);
  root.render(<FilesPage pageCtx={pageCtx} />);
  return () => root.unmount();
}
```

### 4.2 `FilesPage.tsx` — 主布局

```typescript
export function FilesPage() {
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [treeFilter, setTreeFilter] = useState<"git" | "agent">("git");
  const [treeQuery, setTreeQuery] = useState("");

  return (
    <SplitPane settingKey="filesSplitterFraction" initial={0.35}>
      <TreePane filter={treeFilter} query={treeQuery} onOpenFile={openFile} />
      <EditorPane tabs={editorTabs} active={activeTab} onClose={closeTab} />
    </SplitPane>
  );
}
```

**布局决策**：左右分栏，35% 树 + 65% 编辑器。复用 `SplitPane` 组件（`web/src/kit/SplitPane.tsx`），`settingKey` 走 settings 持久化。

### 4.3 `TreePane.tsx` — 左侧树

**数据源**：
1. `repo.tree` 拿文件列表（全量，含 `status` 字段）
2. `repo.status` 拿 git 状态分类（用于按状态分组排序）
3. `agent.task.files` 拿本回合 agent 改动（用于「agent」过滤层）

**渲染**：
- `@tanstack/react-virtual` 做虚拟化（web 已依赖）
- 目录节点可展开/折叠（本地状态）
- 文件节点右侧显示 git 状态字母（M/A/D/U/?）和 +/- 行数
- 搜索框实时过滤路径

**关键交互**：
- 点击文件 → 打开为编辑器标签
- 右键 → 上下文菜单：`file.openInEditor`（外置接力）、`file.revealInExplorer`、`file.showDiff`（跳到底部 DiffView）
- 状态图标叠加：M（黄）、A（绿）、D（红）、U（红闪烁）、?（灰）

### 4.4 `EditorPane.tsx` — 右侧编辑器标签

**标签系统**：
- 横向标签栏（VS Code 语义），显示文件名 + 脏标记（●）
- 中键点击关闭，Ctrl+Tab 切换，Ctrl+W 关闭当前
- **keep-alive**：切标签用 `display: none` 不销毁 Monaco 实例，编辑状态不丢

**Monaco 实例管理**：
```typescript
const editorsRef = useRef(new Map<string, monaco.editor.IStandaloneCodeEditor>());

function getEditor(path: string) {
  let ed = editorsRef.current.get(path);
  if (!ed) {
    ed = monaco.editor.create(host, {
      readOnly: false,
      minimap: { enabled: true },
      wordWrap: "off",
    });
    editorsRef.current.set(path, ed);
  }
  return ed;
}
```

**保存策略**：
- **显式保存**（Ctrl+S）+ **自动保存**（300ms 防抖）双模式
- 保存时调 `file.write` RPC，成功后清脏标记、更新 mtime
- 保存失败（文件被改）弹警告，让用户选「覆盖」或「重新加载」

**Monaco 主题映射**：
```typescript
monaco.editor.defineTheme("gitter-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "keyword", foreground: "FF79C6" },  // 对齐 syntaxColors 9 键
    { token: "string", foreground: "F1FA8C" },
    // ...其余 7 键
  ],
  colors: {
    "editor.background": "#1E1E1E",
    "editor.lineHighlightBackground": "#2A2A2A",
  }
});
```

### 4.5 智能提示/补全与 LSP

**首版（P2，已落地）**：智能提示/补全/校验由 **Monaco 内置语言服务** 提供（§2.3 的 json/css/html/typescript worker 随包内联），开箱覆盖 TS/JS/JSON/CSS/HTML，不依赖任何外部进程。已知限制：内置 TS 服务的跨文件相对导入解析在 monaco 独立宿主下不可靠（`Cannot find module`，诊断码 2307）——同文件符号/内置 API 补全不受影响，工程级解析归外部 LSP。

**P3（已落地）**：其余语言（Python）与 TS/JS 工程级解析经 **外部语言服务器** 补足，实现形态与原设计的 monaco-languageclient 不同——不引入该依赖，自建薄客户端：

- 主进程 `app/src/services/lsp.ts`：按语言键管理 stdio JSON-RPC 子进程（typescript-language-server / pyright），Content-Length 帧协议就地实现（`FrameParser`/`buildMessage` 纯函数导出供冒烟直测），server→client 通知经 `evt` 通道以 `lsp.event` 扇出。
- RPC 五件套：`lsp.status`（open 域）/ `lsp.start` / `lsp.stop` / `lsp.request` / `lsp.notify`（新 `lsp` 权限域，与 terminal 同级的进程级能力）；files 包 manifest 已声明。
- 页面侧 `web/src/pages/filesLsp.ts`：model 生命周期 → didOpen / didChange（全量同步，400ms 防抖）/ didClose；补全 + hover provider；publishDiagnostics → `setModelMarkers`。设置关闭时零 RPC、零 provider 开销。
- 设置四字段（section "editor"）：`lspTypescript` / `lspTypescriptCommand`（默认 `typescript-language-server --stdio`）/ `lspPython` / `lspPythonCommand`（默认 `pyright-langserver --stdio`），默认关。

**LSP server 由后端管理**（P3 已按上述 §4.5 落地）：`app/src/services/lsp.ts` 与终端的 pty 管理同模式；RPC 为 `lsp.start`/`lsp.stop`/`lsp.status`/`lsp.request`/`lsp.notify` 五件套。用户可在设置里选装 `typescript-language-server`（`typescript-language-server --stdio`）和 `pyright`（`pyright-langserver --stdio`）。

---

## 5. 护栏与契约调整

### 5.1 `env.readLog` 刷新

**位置**：`app/src/services/agents/fsx.ts`

新增 `refreshReadLog(abs, mtimeMs)` 函数，编辑器保存成功后调用：

```typescript
export function refreshReadLog(abs: string, mtimeMs: number): void {
  // 更新现有 readLog 条目，不新增（避免重复）
  if (env.readLog.has(abs)) {
    env.readLog.set(abs, mtimeMs);
  }
}
```

### 5.2 `file_patch` 降级重读

**位置**：`app/src/services/agents/builtinTools.ts:422-429`

**现状**：mtime 变化 → 拒绝「被外部修改过」。

**调整**：mtime 变化 → 如果是在 `file.write` 刚写完（最近 2 秒内），降级为「重新读一遍」而不是拒绝。

```typescript
const lastWrite = env.readLog.get(abs);
const current = await statSafe(abs);
if (lastWrite && current && current.mtimeMs > lastWrite) {
  // 区分「agent 写完后 UI 又改了」和「UI 刚写完」
  if (env.lastUiWrite?.abs === abs && Date.now() - env.lastUiWrite.ts < 2000) {
    env.readLog.set(abs, current.mtimeMs);  // 刷新，不拒绝
  } else {
    throw new ToolError("文件被外部修改过，请重新读取");
  }
}
```

**这是唯一需要动 agent 契约的地方**，改动约 10 行。

### 5.3 保存护栏

编辑器保存走 `file.write`，校验：
1. **路径锁**：`fsx.resolveSafe`（resolve + realpath 双重 symlink 校验）
2. **大小护栏**：2 MB 上限（和 `file_write` 一致）
3. **二进制嗅探**：NUL 字节拒绝（避免误改二进制文件）
4. **EOL 保留**：保存时必须用原 EOL，否则 `git diff` 会显示整文件改动

---

## 6. 构建与部署

### 6.1 `web/scripts/build-pages.mjs` 修改

```javascript
const PAGES = ["projects", "log", "changes", "branches", "tasks", "bash", "files", "settings"];
```

Monaco 特殊处理：

```javascript
build: {
  // ... 现有
  rollupOptions: {
    external: ["react", "react/jsx-runtime", "react-dom", "react-dom/client"],
    // Monaco 不 external，随页面打包
    output: {
      globals: {
        "react": "window.GITTER_KIT.React",
        // ... 现有
      },
    },
  },
  workers: {
    format: "iife",
  },
},
```

### 6.2 产物体积（P4 优化后实测）

- `gitui.page.files/page.js`：**~12.6 MB**（minify，esbuild）。构成：Monaco 核心（editor.main + basic-languages）~3.5 MB + 五个语言 worker base64 内联（ts.worker 压缩后仍最大）。
- 其余七页合计 ~1 MB 不变（Monaco 仅 files 页私有依赖，`minify: false` 页面包缺省策略不变）。

体积构成说明：智能提示/补全要求 json/css/html/typescript 四个语言服务 worker 随包内联（§2.3），这是包体的绝对大头。已按本节选项 2 仅对 files 槽启用 minify（未压缩 24.8 → 压缩后 12.6 MB）；剩余收敛手段：

1. 按需加载语言包：`import(...)` 语言服务 contribution，首屏只装 TS/JS——lib IIFE 构建会把动态导入内联，需配合产物拆分，列为后续优化。

### 6.3 部署

页面包随应用分发，manifest 声明 `permissions: ["git.read","git.write","window"]`，信任门免检（内置包）。

---

## 7. 分阶段落地

### Phase 1：基础设施（1-2 天）

1. `repo.tree` RPC（`app/src/services/treex.ts`）
2. `file.content` RPC（复用 `fsx.ts` 路径锁）
3. `file.write` RPC（写护栏 + readLog 刷新）
4. `file_patch` 降级重读（`builtinTools.ts` 10 行改动）
5. 注册表登记 + 空页面壳（`FilesPage.tsx` 空 SplitPane）

### Phase 2：编辑器核心（2-3 天）

1. Monaco 集成（worker 处理、主题映射）
2. `TreePane.tsx`（虚拟化 + 状态图标）
3. `EditorPane.tsx`（标签系统、Monaco 实例管理）
4. 保存流程（显式 + 自动保存、冲突检测）
5. i18n + 设置项（自动保存开关、编辑器主题）

### Phase 3：增强（3-5 天）——已落地（P3）

1. ~~LSP 集成（monaco-languageclient + 后端 LSP 管理器）~~ → 实际形态：自建薄客户端（`lsp.ts` + `filesLsp.ts`，§4.5），不引入 monaco-languageclient
2. 设置页配置（启用哪些语言服务器）→ `lspTypescript`/`lspPython` 开关 + 命令覆盖
3. 树过滤层（git 状态 vs agent 回合切换）→ P1 已随 FilesPage 交付
4. 外置接力右键菜单（`file.openInEditor`）→ P1 已随 TreePane 交付
5. 文档 + 冒烟测试 → smoke（treex 12 断言 + LSP 帧协议/伪服务器 9 断言）、harness files 页（mock RPC + repoChangedTick bump，亮暗双档浏览器验收）、e2e files 槽探针 + boot 槽位计数 8

### Phase 4：优化（按需）——已落地（P4）

1. 按需加载语言包 → 以 files 槽 minify（24.8 → 12.6 MB）替代；worker 本身已按语言懒 spawn，IIFE 单文件内联的 base64 无法懒载，真分包列为后续优化
2. 多光标编辑体验优化 → `multiCursorModifier: "alt"` / 平滑光标与滚动 / 关闭无障碍层重排，显式固定（`filesMonaco.EDITOR_OPTIONS`）
3. 编辑器联动（多个标签同步滚动）→ 单栏布局下无意义，不适用；视图状态按标签 keep-alive（P2 的 viewState 存取）已覆盖"切回不丢位置"诉求，分屏编辑再议

**总计 1-2 周**。

---

## 8. 风险与决策点

### 8.1 已解决的决策

1. **高亮管线**：编辑器用 Monaco 内置 tokenizer，只读预览继续走服务端 `highlight.file`。两条管线服务两个场景，不需要统一。
2. **LSP 路径**：通过 `monaco-languageclient` 接入，不追求 VS Code 插件兼容。
3. **保存策略**：显式 + 自动保存双模式，自动保存 300ms 防抖。
4. **agent 契约**：`file_patch` 撞上 UI 刚写过的文件时降级重读（2 秒窗口），不硬拒绝。

### 8.2 待决决策

1. **LSP server 默认装哪些**：已定 TS/Python 两个（`lspTypescript`/`lspPython`，默认关、命令可覆盖，§4.5）；其余语言按需再加。
2. **Monaco 按需加载**：首版全量加载（简单），后续按需优化。
3. **编辑器保存后是否自动刷新树状态**：建议是（否则用户改完看不到状态变化）。
4. **多仓库支持**：不做（`needRepo()` 单仓库模型，超出本方案范围）。

### 8.3 技术风险

1. **Monaco worker 在 file:// 协议下的加载**：`?worker&inline` + `worker.format: "iife"` → base64 内联 + Blob URL 构造（P2 已验证）。注意不能用裸 `?worker`——会附带产出 ~16MB 的 assets/*.worker-*.js 死重（§2.3）。
2. **包体增长**：files 页 page.js 实测 ~24.8 MB（未压缩，含五个语言 worker 内联；§6.2），其余七页不变。本地包随应用分发、无网络加载，可接受；收敛手段见 §6.2 优化清单。
3. **LSP 进程管理**：新增 `app/src/services/lsp.ts`，和终端的 pty 管理类似，但复杂度低（LSP 是 JSON-RPC，pty 是字节流）。仅 P3+ 其余语言需要。

---

## 9. 与既有决策的关系

### 9.1 推翻的决策

| 决策 | 出处 | 推翻理由 |
|---|---|---|
| 「Monacore 默认不引入」 | `winui3-to-web-migration.md:215` | 原决策面向「提交消息编辑器 + 只读预览」，本方案是「手动改代码」完整场景，能力缺位明确 |
| 「+5MB 包体」估算 | 同上 | 实际 ~4MB（按需加载语言包后），且页面包是独立产物，不影响主 bundle |

### 9.2 保留的决策

| 决策 | 出处 | 保留理由 |
|---|---|---|
| DiffView 自研，不替换 | `winui3-to-web-migration.md:107` | 验收台核心，hunk 勾选/字级 diff 定制成本高 |
| 服务端高亮框架 | `code-highlight-framework.md` | 只读预览继续用，编辑器用 Monaco 内置 tokenizer，两条管线各管各的 |
| 页面包链路 | `ui-full-pluginization-plan.md` | 加槽位只需一行元数据，不动 App.tsx |
| 外置 VS Code 接力 | `commands.ts:78` | 保留作为复杂重构逃生舱，与内建编辑器互补 |

### 9.3 相关但未触及的

| 主题 | 出处 | 关系 |
|---|---|---|
| agent 写工具护栏 | `builtinTools.ts`、`fsx.ts` | 只加 readLog 刷新 + file_patch 降级重读，主契约不变 |
| 终端 pty 管理 | `services/terminal.ts` | LSP 进程管理参考其模式，但不共用代码 |
| 任务模型 | `task-model-modules.md` | agent 回合文件索引用 `agent.task.files`（已有） |

---

## 10. 总结

**架构**：Monacore 作为编辑器控件 + 项目文件树作为新页面槽位，走既有页面包链路，不新建架构层。

**新增**：
- 3 个 RPC（`repo.tree`、`file.content`、`file.write`）
- 1 个页面槽位（`files`）
- 1 个页面包（`gitui.page.files`，实测 ~24.8 MB——Monaco 全量 + 五语言 worker 内联，§6.2）
- 1 个 agent 契约调整（`file_patch` 降级重读，~10 行）
- Phase 3 新增 1 个 LSP 服务（`app/src/services/lsp.ts`，其余语言可选）

**复用**：
- `SplitPane`、`ScrollArea` 等 KIT 组件
- `getStatus()` 的 git 状态分类
- `fsx.ts` 的路径锁和写入护栏
- `agent.task.files` 的回合索引
- 页面包链路（manifest → pageLoader → registerPage → PageOutlet keep-alive）
- `highlight.file` 服务端高亮（只读预览继续用）

**不碰**：
- VS Code 插件兼容（不追求）
- 高亮框架（`highlight.file` 继续服务只读预览）
- agent 写工具主契约（`file_write`/`file_patch` 护栏保留，只加 readLog 刷新）
- DiffView（验收台核心，已定制）

**工作量**：Phase 1-2 核心功能 3-5 天，Phase 3 增强 3-5 天，总计 1-2 周。

**风险**：Monaco worker 加载（P2 已验证 inline blob 可行）、包体 ~24.8 MB（可接受，收敛路径见 §6.2）、LSP 进程管理（仅 P3+ 其余语言需要）。

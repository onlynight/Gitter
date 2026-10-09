# Office 文档编辑能力技术方案

> 状态：**结论已彻底翻转**——2026 年 10 月的开源生态与此前判断完全不同，见 §0.2
> 关联：`inline-editor-plan.md`（Files 页 Monaco 通道）、`extension-package-framework.md`（页面包）、`theme-framework.md`（主题 tokens）、`i18n.md`（Strings.tsv）
> 版本依据：截至 2026-10-09 的 npm dist-tags、tarball 解压、README 原文

---

## 0. 决策摘要

### 0.1 需求

在 Gitter 内支持打开并编辑项目中的 `.xlsx` / `.docx` / `.pptx` 文件，标准「常用功能读写」，能真正兼容 MS Office。

### 0.2 关键发现（彻底翻转前两轮判断）

**开源世界已经存在完整三件套：ChristopherVR/ooxml monorepo。**

证据（2026-10-09 核实）：

1. **`pptx-viewer-core`** — Apache-2.0，v4.13.4（2026-10-08 发布），README 原文：「A TypeScript library that **reads, creates, edits, and saves** PowerPoint (`.pptx`) files. It runs in the browser and in Node.js, with no native or system dependencies.」
2. **`docx-react-viewer`** — Apache-2.0，v0.4.10（2026-10-08 发布），React 组件，「Self-contained: includes the editor, layout engine and legacy .doc reader」
3. **`xlsx-react-viewer`** — MIT，v0.1.0（2026-10-01 发布），「an Excel viewer and editor component to open, edit, calculate and save .xlsx workbooks in the browser」
4. **`ooxml-core`** — Apache-2.0，v1.5.0（2026-10-09 发布），三件套共享的核心引擎
5. 五个框架绑定：React 18/19、Vue 3、Angular、Svelte、Vanilla JS
6. 支持读、写、编辑已有文件，round-trip 保存；加密文件（AES-128/256）；legacy .ppt/.doc/.xls 兼容导入

**这个 monorepo 就是开源世界的 OOXML 三件套编辑器**，与 Univer（Pro 独占 IO）和 ONLYOFFICE（AGPL + 服务化）形成三方对照。

### 0.3 修正后的现实判断

**开源纯前端 Office 三件套编辑器方案是存在的**，且**Apache-2.0 许可，无 AGPL 传染风险，无服务化需求**。

前两轮结论修正：
- 前两轮说「Univer 是唯一可接受选项」——错，Univer OSS 没有 OOXML IO（§3.1）
- 前两轮说「开源纯前端 OOXML 编辑方案不存在」——错，ChristopherVR/ooxml 完整存在（§3.2）
- 前两轮说「PPT 编辑在纯前端开源世界无解」——错，`pptx-viewer-core` + `pptx-react-viewer` 有完整实现

**唯一顾虑**：这个 monorepo 相对较新（pptx-viewer-core 是 2026-10 从 `ChristopherVR/pptx-viewer` 迁移过来的），需要谨慎评估稳定性。但看代码活跃度、npm 下载量、明确的 limitations 文档，这是认真在做的项目，不是实验性玩具。

---

## 1. ChristopherVR/ooxml：完整能力矩阵

### 1.1 三件套能力对比

| 组件 | License | 最新版本 | 发布日期 | 成熟度 |
|---|---|---|---|---|
| **pptx** | Apache-2.0 | pptx-viewer-core 4.13.4 / pptx-react-viewer 4.30.3 | 2026-10-08 | **最成熟**，round-trip 编辑已实现 |
| **docx** | Apache-2.0 | docx-react-viewer 0.4.10 | 2026-10-08 | **编辑器形态完整**，0.4.x 版本 |
| **xlsx** | MIT（core）+ Apache-2.0（Vue 版） | xlsx-react-viewer 0.1.0 / xlsx-vue-viewer 0.5.1 | 2026-10-01 / 10-08 | **最年轻**，0.1.x，需要评估 |

### 1.2 pptx-viewer-core 能力清单（README 原文核实）

- **Read**：打开 .pptx 提取 slides、text、shapes、images、charts、tables、SmartArt、themes、comments、animations、transitions
- **Import**：legacy binary .ppt（PowerPoint 97-2003）通过 compound file 检测自动转换
- **Export**：`save(slides, { outputFormat: 'ppt' })` 输出真实 binary .ppt（MS-PPT/OfficeArt + OLE2），可选 RC4 加密
- **Edit**：内存中增删改元素、编辑文本、样式调整、主题切换
- **Save**：写回合法 .pptx，**未编辑的 slides 原样保留**（round-trip 保真）
- **Convert**：转 Markdown（可选提取图片）
- **Split**：任意 slides 子集导出为独立 .pptx
- **Protect**：AES-128/256 加密文件读写
- **导出格式**：PNG / JPEG / SVG / PDF / GIF / 视频 / Markdown
- **i18n**：EN / DE / ES / FR / 简体中文

### 1.3 关键 API（用于 Gitter 集成）

```typescript
import { PptxHandler } from 'pptx-viewer-core';

// 读
const handler = new PptxHandler();
const data = await handler.load(buffer);  // buffer = ArrayBuffer

// 编辑
data.slides[0].elements[0].text = 'Updated title';

// 写回
const outputBytes = await handler.save(data.slides);  // => Uint8Array
```

**关键优势**：这个 API 是**框架无关**的，可以在 Node 主进程（`utilityProcess.fork`）或 renderer worker 里跑，不必绑定 React UI。

### 1.4 诚实的已知限制（README 有专门页面）

- SmartArt 布局「没有缓存的 drawing 时是近似」——143 种布局里 129 种匹配 PowerPoint 字号
- 一些动画方向只是 presetSubtype 近似
- 3D shape/scene 和 WordArt envelope warps 是 CSS 近似，不精确
- 编辑后保存可能「touch minor markup」（未编辑 slides 完全 round-trip）

**这些限制对 Gitter 场景（Git 客户端里改改 pptx）是可接受的**。

---

## 2. 其它候选项目全景

### 2.1 Univer（Pro 独占 IO，见 §3.1）

- Apache-2.0，22499★，`@univerjs/sheets` 4.77MB、`@univerjs/docs` 1.27MB、`@univerjs/slides` 178KB、`@univerjs/slides-ui` 551KB
- **OOXML 文件 IO 全部在 `@univerjs-pro/*` 命名空间（商业授权）**
- 开源包代码里 grep `pptx/xlsx/docx` **零匹配**
- 结论：**开源版是「空编辑器」**，无法加载/保存任何真实 OOXML 文件

### 2.2 @office-kit/pptx（编程式编辑库）

- MIT，v0.24.0，`unpackedSize` 6MB，依赖 `fflate`
- 描述：「Generate and edit .pptx (OOXML PresentationML) files from TypeScript, in Node and the browser.」
- **有 getter 也有 setter**——能读已有 pptx 并改写
- 支持所有 16 种 ECMA-376 图表类型、95 个动画预设、Slide Transitions、Comments、音视频
- 明确标注「0.x, pre-1.0, API 未冻结」
- **不是可视化编辑器**，是编程式 API。适合「批量文本替换」等简单操作，不适合 UI 嵌入

### 2.3 @office-kit/docx

- Apache-2.0，v0.2.0（2026-10-07），「OOXML-compliant .docx generation for browser and Node.js.」
- **0.2.0 极年轻**，未成熟

### 2.4 pptx-glimpse

- MIT，v5.3.1，「High-level PPTX rendering and editing toolkit for SVG/PNG output」
- `createPptxEditorSession` 提供 read/edit/rerender/history/save 集成
- 更偏 SVG/PNG 输出，**不是可视化编辑器**

### 2.5 PPTist（pipipi-pikachu）

- **AGPL-3.0**（决定性排除项）
- 9373★，2026-10-08 仍在推
- Vue 3 生态，作者明确说不该作为 npm 库使用，需 fork 整个项目改造
- pptx IO 是弱项（Q&A 原文承认）
- 结论：Vue 生态 + AGPL + 非库设计 + 与 Gitter 的 React 不匹配

### 2.6 @silurus/ooxml（WASM 路线）

- Apache-2.0，v0.88.0（2026-09-21），「Browser-based OOXML viewer (docx/xlsx/pptx) — Rust/WASM parser + Canvas renderer」
- **只读预览**，不是编辑器
- 可作为只读预览的备选方案（对比 mammoth.js）

### 2.7 dom-docx（新出现）

- v1.0.3（2026-09-19），「Convert semantic HTML to native, editable docx files (OOXML)」
- 单向转换工具，**不是编辑器**

### 2.8 事实死亡或排除

- **Luckysheet 2.1.13**：原作者 2023 删库，fork 全部 0–1★
- **ONLYOFFICE DocumentServer**：AGPL-3.0，功能最强但需服务化
- **SheetJS xlsx 0.18.5**：主仓库 2024-04-18 停更
- **python-pptx / openpyxl / python-docx**：MIT 但需 Python 运行时，打包体积爆炸
- **Apache POI POI-Slide**：Apache-2.0 但需 JRE

---

## 3. 主要候选的详细优缺点

### 3.1 Univer（排除）

**优点**：Apache-2.0、22499★、React 原生、活跃社区、完整 UI + 数据模型

**缺点（决定性）**：
- **OOXML 文件 IO 全部在 Pro 商业版**
- 开源包无法加载/保存任何真实 OOXML 文件
- 只能做「空编辑器」，对 Gitter「打开项目已有文件」场景完全不适用

**结论**：排除。

### 3.2 ChristopherVR/ooxml（**推荐**）

**优点**：
- Apache-2.0（pptx / docx / shared core），MIT（xlsx core），**零法务风险**
- **纯前端 + 无后端**，Electron 直接嵌入
- **三件套齐全**：pptx / docx / xlsx 都有实现
- 5 个框架绑定，React 首选
- API 框架无关，可在 worker 或主进程跑
- pptx round-trip 保真（未编辑 slides 原样保留）
- 加密文件支持（AES-128/256）
- legacy .ppt/.doc/.xls 兼容导入
- 有专门的 limitations 文档，透明度高
- 有 MCP 服务接口（70+ tools）——对 Gitter 的 agent 生态有额外价值

**缺点**：
- **项目相对年轻**：pptx 2026-10 从 `ChristopherVR/pptx-viewer` 迁移到 monorepo；xlsx 最新 0.1.x 极年轻；docx 0.4.x 也不稳定
- **成熟度不均**：pptx 最成熟（4.13.x），xlsx 最不成熟（0.1.x），docx 中等（0.4.x）
- **体积**：pptx-react-viewer 14.6MB 解包（含依赖），xlsx-react-viewer 3.75MB 解包；比 Univer 更重
- **社区验证数据少**：xlsx 版本太新，没有大量用户反馈佐证
- **pptx 的 SmartArt/3D/WordArt 是 CSS 近似**，对复杂 pptx 会有视觉差异

**结论**：**推荐作为主推方案**。风险在成熟度而非技术可行性。

### 3.3 @office-kit/pptx（备选，编程式）

**优点**：MIT、140K 月下载、编程式 API 稳定、支持所有 ECMA-376 图表类型

**缺点**：
- 0.x API 未冻结
- 无 UI 编辑器（配 `@office-kit/pptx-editor` 有 UI 但功能较弱）
- 更适合「批量修改」而不是「可视化编辑」

**结论**：可作为 pptx-viewer 的稳定后备，或用于「只做文本替换」的轻量场景。

### 3.4 ONLYOFFICE DocumentServer（排除）

**优点**：唯一排版保真度接近真 Office 的方案

**缺点（决定性）**：
- AGPL-3.0，Gitter 存在 `extensions` 远程包加载与 agent 远端，法务风险不可控
- 需要 Docker/HTTP 服务，与 Gitter 紧凑分发模型冲突
- 主题体系独立，无法接入 Gitter 的 `theme.gitui.*`

**结论**：除非接受 AGPL + 服务化成本，否则排除。

---

## 4. 落到 Gitter 的集成方案

### 4.1 建议策略：**pptx 优先，分阶段推进**

按成熟度排序：**pptx > docx > xlsx**，反直觉但与项目实际状态一致。

**理由**：
- Git 项目里 `.pptx` 文件比 `.xlsx` 更少见，但对开发者来说「能编辑」的价值更高（因为其它编辑器少）
- pptx-viewer-core 4.13.x 是三件套里最成熟的，round-trip 保真已实现
- xlsx-viewer-core 0.1.x 太新，风险最高
- Gitter 有 Univer 作为 xlsx 备选路径（虽然 Univer 开源无 IO，但可以自建 xlsx IO 层：SheetJS 读 + ExcelJS 写，中间用 Univer UI）

### 4.2 Phase 1：pptx 编辑（推荐先做）

**目标**：Gitter 内能打开、编辑、保存 .pptx 文件，常用功能完整。

**技术选型**：
- `pptx-react-viewer`（Apache-2.0，React 绑定）作为 UI 层
- `pptx-viewer-core`（Apache-2.0）作为引擎层，可独立调用
- 5 个框架绑定里选 React（Gitter 技术栈一致）

**集成路径**：
1. `app/src/services/treex.ts` 增加 OOXML 白名单分支，`.pptx` 走二进制通道
2. `app/resources/packages/gitui.page.office/` 新建页面包（新 slot，或复用 Files 页）
3. `web/scripts/build-pages.mjs` 扩展 `minify` 白名单加入 `office` slot
4. `pptx-react-viewer` 作为**页私有依赖**（不进入主壳 bundle）
5. Worker：pptx-viewer-core 有独立的 `signature-node` 和 `converter` 子入口，需评估是否用 worker
6. CSP：需评估是否需要 `worker-src`（`?worker&inline` 模式同 Monaco）

**验证清单**（Phase 1 完成条件）：
- [ ] 打开真实 .pptx 文件成功
- [ ] 编辑文本并保存回 .pptx，用 PowerPoint 打开验证
- [ ] 复杂 pptx（含 SmartArt、3D、WordArt）round-trip 不崩溃
- [ ] 加密文件（AES）能正确读写
- [ ] legacy .ppt 能导入
- [ ] 5MB 以内 pptx 加载 < 3s

### 4.3 Phase 2：docx 编辑

**目标**：复用 Phase 1 链路，接入 `docx-react-viewer`。

**风险**：docx-react-viewer 是 0.4.x，成熟度低于 pptx。需要单独验证。

**关键测试项**：
- [ ] Word 里嵌套表格、页眉页脚、脚注、目录域的兼容性
- [ ] docx → pptx → docx 的字节稳定性
- [ ] 500KB docx 加载 < 2s

### 4.4 Phase 3：xlsx 编辑

**目标**：接入 `xlsx-react-viewer` 或走替代路线。

**风险**：xlsx-react-viewer 是 0.1.0，最不成熟。

**替代路线**：
- Univer Sheets（Apache-2.0 UI + 数据模型）+ SheetJS（Apache-2.0 数据 IO）自组合
- 用 Univer UI 承接用户编辑，用 SheetJS 做 xlsx 文件 IO 层
- 这条路线绕过了「OOXML IO」的核心问题，因为 SheetJS 已经解决了

**推荐**：如果 xlsx-react-viewer 0.1.x 表现不佳，走替代路线。

### 4.5 前置改造（三件套共用）

**treex OOXML 通道**（`app/src/services/treex.ts`）：
- 加 OOXML 白名单：`.xlsx` / `.docx` / `.pptx` / `.xls` / `.doc` / `.ppt` / `.xlsm` / `.docm` / `.pptm`
- 跳过 NUL 字节嗅探，标记 `kind: "ooxml"`
- 二进制读写通道：`file.content` 返回 base64，`file.write` 接受 base64
- 放宽大小限制：`MAX_READ_BYTES_OOXML = 50MB`，`MAX_WRITE_BYTES_OOXML = 20MB`
- 走现有 path lock 和 `agents.refreshReadLogFor`

**这是零风险的地基改造**，为未来任何方案（包括商业 Univer Pro、新的开源项目）都提供基础。

---

## 5. 关键前置改造：treex 二进制通道

Phase 1 的前置项，也是三件套共用的地基。

### 5.1 当前约束（`app/src/services/treex.ts`）

```
- readFileContent: UTF-8 文本解码，NUL 字节嗅探 → binary:true → 拒绝
- writeFileContent: MAX_WRITE_BYTES = 2MB，强制 EOL 保留
- 8MB 读上限
```

### 5.2 改造方案

```typescript
const OOXML_EXTS = new Set([
  ".xlsx", ".docx", ".pptx",
  ".xlsm", ".docm", ".pptm",
  ".xls", ".doc", ".ppt",
]);

function detectKind(filePath: string, buffer: Buffer): "text" | "binary" | "ooxml" {
  if (OOXML_EXTS.has(path.extname(filePath).toLowerCase())) return "ooxml";
  // 原有 NUL 嗅探逻辑
}

// API 扩展（向后兼容）
// 现有：readFileContent 返回 { text: string, ... }
// 新增分支：当 kind === "ooxml" 时返回 { base64: string, kind: "ooxml", size: number, ... }

// 现有：writeFileContent(path, text) 接受 UTF-8 字符串
// 新增分支：writeFileContent(path, { kind: "ooxml", base64: string }) 接受二进制 payload
```

### 5.3 大小限制（OOXML 分支专用）

- `MAX_READ_BYTES_OOXML = 50MB`
- `MAX_WRITE_BYTES_OOXML = 20MB`

### 5.4 EOL 保留

OOXML 分支跳过 EOL 保留逻辑（zip 内字节不做文本变换）。

### 5.5 path lock + agent refreshReadLogFor

走现有通道，无新增。

---

## 6. 体积预算

### 6.1 现有基线

- Monaco 页包 `gitui.page.files/page.js` ≈ 24.8MB unminified
- 其它 7 个页合计 ~1MB
- 主壳 `web/dist/assets/index-*.js` ≈ 300KB，CSS ≈ 64KB

### 6.2 Office 页估算

| 组件 | 解包大小 | 编译后（估算） |
|---|---|---|
| pptx-react-viewer + ooxml-core | 14.6MB + ? | 3–6MB |
| docx-react-viewer + docx-core | ~23KB（很轻） | 1–3MB（含 ooxml-core 共享） |
| xlsx-react-viewer + xlsx-viewer-core | 3.75MB | 1–2MB |
| **三件套合计** | ~19MB | **5–10MB** |

### 6.3 处理策略

- **页私有依赖**：走 `web/scripts/build-pages.mjs` 的 slot 私有依赖链路
- **开 minify**：`minify: slot === "office"`，同 files slot
- **Worker 内联**：pptx-viewer-core 的 `signature-node` / `converter` 子入口按需启用，走 `?worker&inline` + base64
- **CSS 自注入**：pptx/react-viewer 有 CSS 需内联，扩展现有 `monacoCssInline` Vite 插件

**体积决策门槛**：如果最终 office 页包 > 40MB，考虑拆分为独立页面包（`gitui.page.pptx` + `gitui.page.docx` + `gitui.page.xlsx`），各自 lazy 加载。

---

## 7. CSP 与主题接入

### 7.1 CSP 改造

现有 CSP：`default-src 'self'` / `img-src 'self' data:` / `font-src 'self' data:`。

- **worker-src**：pptx-viewer-core 的 signature 和 converter 子入口可能需要 worker，评估后按 `?worker&inline` + base64 处理
- **不改 connect-src**：pptx-viewer 纯前端，无网络请求

### 7.2 主题接入

- pptx-react-viewer 有独立的样式系统（Tailwind CSS）
- 映射到 `theme.gitui.*` tokens：需要一层 CSS 变量映射
- **风险**：pptx-viewer 的样式基于 Tailwind，与 Gitter 的 token 系统耦合度低，需要专门适配层

### 7.3 i18n 接入

- pptx-viewer 有 i18n 支持（EN/DE/ES/FR/简体中文）
- **不接入** pptx-viewer 的 i18n 系统，Gitter 用 `Strings.tsv` 单一源
- pptx-viewer locale 作为「兜底文案」，Gitter 侧 `Strings.tsv` 增加 `Office_*` 键覆盖关键交互

---

## 8. 未来复评触发点

### 8.1 ChristopherVR/ooxml 相关

- pptx-viewer-core 发布 1.0.0（当前 4.13.x 已在稳定通道）
- docx-react-viewer 达到 1.0.0（当前 0.4.x）
- xlsx-react-viewer 达到 1.0.0（当前 0.1.0，最重要）

### 8.2 竞争项目

- Univer 开源版开放 OOXML IO（当前 Pro 独占）
- ONLYOFFICE 改变许可（历史上有过部分企业版改 Apache 的先例）
- 出现新的开源纯前端 OOXML 编辑器

### 8.3 Gitter 侧

- 用户调研出现明确编辑需求（哪个格式优先级最高）
- 是否接受为「Office 完整兼容」走服务化（ONLYOFFICE 路线）

---

## 9. 附录

### 9.1 关键调研证据

**ChristopherVR/ooxml 三件套完整**（决定性证据）：

```
npm pack pptx-viewer-core@4.13.4  → 14.6MB 解包，Apache-2.0
npm pack docx-react-viewer@0.4.10 → 23KB 解包，Apache-2.0
npm pack xlsx-react-viewer@0.1.0  → 3.75MB 解包，MIT
npm pack ooxml-core@1.5.0         → 三件套共享引擎，Apache-2.0
```

**pptx-viewer-core README 原文**（能力核实）：

> "A TypeScript library that **reads, creates, edits, and saves** PowerPoint (`.pptx`) files. It runs in the browser and in Node.js, with no native or system dependencies."
>
> "Hand it the bytes of a `.pptx` file and it gives you back a structured, fully typed object... Change anything in that object and write it back to a valid `.pptx`."

**Univer OSS 无 OOXML IO**（对比证据）：

```
tar tzf @univerjs/slides-ui-1.0.3.tgz | xargs grep -l pptx → 零匹配
tar tzf @univerjs/sheets-1.0.3.tgz     | xargs grep -l xlsx → 零匹配
tar tzf @univerjs/docs-1.0.3.tgz       | xargs grep -l docx → 零匹配

Univer packages/ 目录完整清单：无 excelio/docxio/pptxio/exchange/connector
```

### 9.2 版本与许可证快照（2026-10-09）

| 项目 | 版本 | License | 最近提交 | Stars | 状态 |
|---|---|---|---|---|---|
| **pptx-viewer-core** | **4.13.4** | **Apache-2.0** | **2026-10-08** | - | **最成熟，推荐** |
| **pptx-react-viewer** | **4.30.3** | **Apache-2.0** | **2026-10-08** | - | **推荐** |
| docx-react-viewer | 0.4.10 | Apache-2.0 | 2026-10-08 | - | 中等成熟度 |
| docx-vue-viewer | 0.4.10 | Apache-2.0 | 2026-10-08 | - | 中等成熟度 |
| xlsx-react-viewer | 0.1.0 | MIT | 2026-10-01 | - | **最年轻** |
| xlsx-vue-viewer | 0.5.1 | Apache-2.0 | 2026-10-08 | - | 稍好 |
| ooxml-core | 1.5.0 | Apache-2.0 | 2026-10-09 | - | 共享核心 |
| @office-kit/pptx | 0.24.0 | MIT | 2026-10-09 | - | 编程式，非 UI |
| @office-kit/docx | 0.2.0 | - | 2026-10-07 | - | 极年轻 |
| pptx-glimpse | 5.3.1 | MIT | 2026-08-13 | - | 非可视化 |
| pptx-preview | 1.0.7 | ISC | - | - | 只读预览 |
| PPTist | - | **AGPL-3.0** | 2026-10-08 | 9373 | **排除** |
| Univer 开源 | 1.0.3 | Apache-2.0 | 2026-09-29 | 22499 | **无 OOXML IO，排除** |
| Univer Pro | 1.0.3 | 商业 | 2026-09-29 | - | 商业授权 |
| ONLYOFFICE DocServer | - | **AGPL-3.0** | 2026-07-22 | 6983 | 需服务化，排除 |
| SheetJS | 0.18.5 | Apache-2.0 | **2024-04-18 停更** | 36350 | 冻结 |
| mammoth.js | 1.13.0 | BSD-2-Clause | 2026-09-26 | 6319 | 仅只读 |
| exceljs | 4.4.0 | MIT | 活跃 | - | 无 UI |
| Luckysheet | 2.1.13 | 无 license | **2023 删库** | - | 事实死亡 |
| python-pptx | - | MIT | 活跃 | - | Python 运行时 |
| openpyxl | - | MIT | 活跃 | - | Python 运行时 |

### 9.3 pptx-viewer-core 能力矩阵

| 能力 | 支持 |
|---|---|
| 读 .pptx | ✅ |
| 写 .pptx（round-trip） | ✅ |
| 编辑已有 .pptx | ✅ |
| 新建 .pptx | ✅ |
| 读 legacy .ppt | ✅（自动转换） |
| 写 binary .ppt | ✅ |
| 加密文件（AES-128/256） | ✅ |
| 转 Markdown | ✅ |
| 导 PNG/JPEG/SVG/PDF/GIF/视频 | ✅ |
| SmartArt | 部分（129/143 布局匹配字号） |
| 3D shape/scene | CSS 近似 |
| WordArt envelope warps | CSS 近似 |
| 动画方向 | presetSubtype 近似 |
| i18n | EN/DE/ES/FR/简体中文 |

### 9.4 Univer 包体积明细（对比参考）

```
@univerjs/presets         20KB    聚合入口
@univerjs/core          4.4MB
@univerjs/sheets        4.8MB
@univerjs/docs          1.3MB
@univerjs/slides        178KB    数据模型，无 UI
@univerjs/slides-ui     551KB    真实 UI，但无文件 IO
@univerjs/design        -        11 deps

@univerjs-pro/exchange-client  526KB    **OOXML IO 在这里（商业）**
@univerjs-pro/slides     1.37MB    扩展 slides 数据模型（商业）
@univerjs-pro/slides-ui  -         扩展 slides UI（商业）
```

### 9.5 相关文档

- `inline-editor-plan.md` — Files 页 Monaco 编辑器方案
- `extension-package-framework.md` — 页面包框架
- `theme-framework.md` — 主题 tokens
- `i18n.md` — Strings.tsv 规范
- `plugin/plugin-api.md` — `registerPreviewProvider` 扩展点

### 9.6 决策变更记录

- **初版判断**：Univer 是唯一可接受选项，PPT 编辑不做
- **第 2 版判断**：Univer OSS 无 OOXML IO，推荐降级路线（只读预览 + 外部打开）
- **第 3 版判断（当前）**：
  1. ChristopherVR/ooxml monorepo 是完整开源 OOXML 三件套，Apache-2.0，无 AGPL 风险
  2. pptx-viewer-core 4.13.x 已成熟到「round-trip 编辑」级别
  3. 推荐 pptx 优先（Phase 1），docx 次之（Phase 2），xlsx 走 Univer + SheetJS 自组合路线（Phase 3）
  4. 前置改造：treex OOXML 通道（三件套共用，零风险）
  5. 关键顾虑：项目相对年轻，xlsx 尤其不成熟，需 Phase-by-phase 验证

### 9.7 待补充的实测数据

以下数据需在 Phase 1 实际接入后回填：

- [ ] pptx-react-viewer 编译后实际 bundle 体积（估算 3–6MB）
- [ ] pptx-viewer-core 的 worker 内联可行性
- [ ] 5MB pptx 打开延迟（目标 < 3s）
- [ ] pptx round-trip 字节稳定性量化指标
- [ ] SmartArt / 3D / WordArt 的实际视觉差异样本
- [ ] pptx-viewer 与 Gitter 主题 tokens 的覆盖率
- [ ] docx-react-viewer 0.4.x 的成熟度评估（Phase 2 前）
- [ ] xlsx-react-viewer 0.1.x 的成熟度评估（Phase 3 前）

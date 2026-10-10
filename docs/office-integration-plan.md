# Office 文档能力技术方案

> 状态：**方案 v3——预览-only（2026-10-10 定稿，见 §10）**。Gitter 内只做预览，编辑一律交给外部应用。
> 预览格式：**pdf / docx / xlsx / xlsm / ods / csv / tsv**（pptx 试做，保真不达标即砍）；
> 旧格式与无成熟渲染器的格式走外部打开（§10.4）。
> v1/v2（ChristopherVR/ooxml 三件套页内编辑）已实测废弃：xlsx 挂载冻结（§9.9）、pptx 崩溃（§9.10）、
> viewer 注入 CSS 污染宿主（侧边栏动效丢失，§10.1）。§0–§9 保留为历史调研与实测记录。
> 关联：`inline-editor-plan.md`（Files 页 Monaco 通道）、`extension-package-framework.md`（页面包）、`theme-framework.md`（主题 tokens）、`i18n.md`（Strings.tsv）
> 版本依据：截至 2026-10-10 的 npm registry / 下载量数据

---

## 0. 决策摘要

> ⚠️ **本节及 §1–§3 为 v1/v2 调研记录，已被 §10（预览-only）取代。**
> §0.2/§0.3 的「成熟度」结论经 §9 实测证伪：三件套能跑通 demo，但作为页内组件
> 嵌入宿主文档会带来冻结 / 崩溃 / CSS 污染三类结构性问题（§10.1）。

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

> ⚠️ **v2 集成方案，已被 §10（预览-only）取代**——保留作实施史对照（§9 记录了按本节
> 实施后遇到的三起事故与处置）。

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

### 6.2 Office 页实测（Phase 1 构建后回填）

| 组件 | 解包大小 | 实际产物 |
|---|---|---|
| pptx-react-viewer 4.31.1 + pptx-viewer-core 4.13.4 + framer-motion/lucide/jszip/jspdf/zod 等 | ~19MB | **`gitui.page.office/page.js` = 10.5MB（minified）** |
| 对照：files 页（Monaco 全量） | - | 13MB（minified） |
| 对照：其余 7 页合计 | - | ~1MB |

实际体积高于 §6.2 初估（3–6MB）——viewer 传递依赖（framer-motion、jspdf、zod、i18next）全部内联；仍低于 files 页，远低于 40MB 拆包门槛，**维持单页面包方案**。

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
- xlsx-react-viewer 发布任何修复版本（当前 0.1.0，最重要——2026-10-10 实测其挂载即
  渲染风暴冻结整个 UI，见 §9.8；修复后恢复挂载需按 officeXlsxViewer.tsx 头注三步回归）
- 上游仓库已改名 **SEMOSS/xlsx-viewer**（旧 SEMOSS/excel-viewer 404）；npm 上 0.1.0 之后无版本、
  仓库单 commit 无 issues——复评时先看 npm 是否发了 0.1.1+

### 8.2 竞争项目

- Univer 开源版开放 OOXML IO（当前 Pro 独占）
- ONLYOFFICE 改变许可（历史上有过部分企业版改 Apache 的先例）
- 出现新的开源纯前端 OOXML 编辑器

### 8.3 Gitter 侧

- 用户调研出现明确编辑需求（哪个格式优先级最高）
- 是否接受为「Office 完整兼容」走服务化（ONLYOFFICE 路线）
- **2026-10-10：编辑需求由外部应用承接（§10），本节全部触发点随 v2 方案一并归档；
  当前有效方案为 §10，其复评触发点见 §10.8**

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
- **Phase 1 落地（2026-10-10）**：
  1. `gitui.page.office` 新槽位（order 71）+ `OfficePage`（pptx-react-viewer 4.31.1 / pptx-viewer-core 4.13.4，页私有 minified 10.5MB）
  2. treex OOXML 通道：`file.stat` / `file.readBinary` / `file.writeBinary`（读 50MB / 写 20MB，白名单 10 扩展名，rpcScopes 映射 git.read/git.write）
  3. build-pages 泛化 `vendorCssInline`（monaco + pptx-react-viewer/ooxml-ui），office 槽开 minify
  4. 主题映射（Gitter tokens → viewer 语义色）、i18n（Strings.tsv 20 键 + 包内 zh-Hans.json）、包文档（docs/zh-Hans.md）
  5. 验证：treex 往返字节一致 + 白名单负例、boot-check 9 槽位 PASS、权限 E2E PASS、空态截图验收

### 9.7 实测回填（Phase 1，2026-10-10）

- [x] `gitui.page.office/page.js` 实际体积：**10.5MB（minified）**——低于 files 页 13MB，维持单包方案
- [x] worker 内联：viewer 无 worker 依赖（主线程渲染），无需 `?worker&inline`；CSS 经 `vendorCssInline` 插件内联（18 个自注入 style 模块，字体全 data URI，无外部 url 引用）
- [x] treex 二进制通道往返：引擎生成真实 pptx（15,917B）→ `readBinaryContent` → `writeBinaryContent` → **字节级一致**，引擎可重读（slides=1、文本完整）；白名单负例（`.bin`）读返回 null、写拒绝 `binary` 错误；`statFile` 正常
- [x] 启动回归门：boot-check exit 0（9 槽位含 office 全部解析为内置包，语言热重载后仍在册）；权限 E2E PASS
- [x] 页面挂载截图验收：office 空态（无仓库 pptx 时）布局/中文渲染/主题一致
- [ ] pptx round-trip 字节稳定性量化（真实复杂 pptx 样本）——**待人工验收**
- [ ] SmartArt / 3D / WordArt 实际视觉差异样本——待人工验收
- [ ] 5MB pptx 打开延迟（目标 < 3s）——待人工验收
- [ ] 主题 tokens 覆盖率（viewer 内 CSS 变量映射后有无违和）——待人工验收
- [ ] docx-react-viewer / xlsx-react-viewer 成熟度评估（Phase 2/3 前）

**残留集成风险**：`PowerPointViewer` 组件在真实应用内的「点击文件 → 加载 → 编辑 → 保存」全链路（UI 层）仅经类型与产物完整性验证，未做自动化端到端（boot 钩子无点击文件能力）——建议人工打开一个真实 .pptx 走一遍保存流程。

### 9.8 实测回填（Phase 2/3，2026-10-10）

**三格式接线完成**：`OfficePage.tsx` 统一以 `onSave(bytes)` 契约消费三种 viewer，冲突检测 + 写回同一代码路径。

- [x] docx 接线：`docx-react-viewer` 是命令式 ref API（`load(bytes)` / `save()→Blob` / `markClean()`），经 `officeDocx.tsx` 包装桥接为 props 式契约；宿主 Ctrl+S → `saveSignal` 自增 → `ref.save()` → `Blob` → `ArrayBuffer` → `onSave(bytes)`
- [x] xlsx 接线：`xlsx-react-viewer` 与 pptx 同为 props 式（`content`/`onSave`），直接透传；`theme` 用同一份 `viewerThemeFromTokens`（19 个共享 `ViewerThemeColors` 键）
- [x] `officeKindOf` 统一分派 `.pptx/.pptm/.ppsx` / `.docx/.docm/.dotx` / `.xlsx/.xlsm/.xltx`；列表徽标三色（pptx 琥珀 / docx 蓝 / xlsx 绿）
- [x] 三种格式往返：引擎生成真实文件 → `readBinaryContent` → `writeBinaryContent` → **字节级一致**（pptx 15,909B / docx 2,558B / xlsx 4,992B，PASS）；9 个 OOXML 扩展全 ACCEPT，`.bin` REJECTED
- [x] 产物体积：`gitui.page.office/page.js` = **14,259,038B（13.48MB，minified）**，含 `PowerPointViewer` + `WordEditor` + `ExcelViewer` 三个 viewer 标记；较 Phase 1 的 10.5MB 增长 3.0MB
- [x] 构建链泛化：`monacoCssInline` → `vendorCssInline`，VENDOR 白名单含 `pptx-viewer-core` / `docx-core` / `docx-react-viewer` / `xlsx-viewer-core` / `xlsx-react-viewer`；bare specifier 用 `createRequire(web/package.json).resolve()` 解析（首次裸名当相对路径解析会注入 `\0vendor-css:` 空字节 → PLUGIN_ERROR）
- [x] 验证门全绿：`tsc --noEmit` clean、9 页构建完成、`app npm run build` clean、boot-check PASS（存活 18112ms，退出码 0）、权限 E2E PASS、三格式往返 ALL PASS
- [x] 页面挂载截图验收：office 页在真实仓库（3 个 OOXML 文件）下列表正确渲染，DOCX/PPTX/XLSX 三色徽标 + 中文文案 + 主题一致

**新增验证钩子**：`GITTER_SHOT_REPO=<git 仓库>`——截图前经 `app.openRepo` 事件切仓库（该事件在 `App.tsx` 用宿主侧 `call`，无 `__caller` 权限校验；裸 `executeJavaScript` 的 `window.GITTER_UI.call("repo.open")` 会被 `[audit.rpc.denied] need=window` 拒，因为无 caller 身份）。注意截图钩子必须排在 boot 断言（`bootExitMs` 处 `app.exit`）之前，否则余量不足会被杀进程。

**新增依赖**（`web/package.json`，共 9 个）：`fast-xml-parser`、`framer-motion`、`i18next`、`jspdf`、`jszip`、`lucide-react`、`pptx-react-viewer`、`pptx-viewer-core`、`docx-react-viewer`、`xlsx-react-viewer`

**残留待人工验收**（与 §9.7 合并）：

- pptx round-trip 字节稳定性量化（真实复杂样本，非引擎生成）
- SmartArt / 3D / WordArt 实际视觉差异样本
- 5MB pptx 打开延迟（目标 < 3s）
- 主题 tokens 覆盖率（viewer 内 CSS 变量映射后有无违和）
- docx-react-viewer / xlsx-react-viewer 成熟度：**两者均为 0.x**（`docx-react-viewer` 0.4.10 / `xlsx-react-viewer` 0.1.0），API 可能在后续版本破坏性变更——已在 §8.1 列为复评触发点
- pptx / docx「点击文件 → 编辑 → 保存」UI 全链路仍仅经类型与产物完整性验证，未自动化端到端

### 9.9 xlsx 挂载冻结事件与降级决策（2026-10-10 下午）

**用户实测反馈「excel 打开以后整个界面都无法操作」**，排查结论与处置如下。

**现象**：点击任一 `.xlsx`（引擎生成的空表和有内容的表都一样）→ 渲染进程主线程被完全饿死
（50ms 定时器 8s+ 无响应、capturePage 之前的所有 `executeJavaScript` 永久挂起），内存数秒内
涨至 1GB+；其它页面全部无法操作。docx / pptx 不受影响（对照实验：漂移 61/62ms vs 冻结）。

**定位过程**（新验证钩子全部留在 `app/src/main.ts` 截图 harness 里，后续可复用）：

- `GITTER_SHOT_CLICK` + 定时器漂移探针——量化「冻结」；`GITTER_SHOT_PROBE_HANG` 的
  `Debugger.pause` 路线失败（忙循环无中断点）；
- `GITTER_TRACE_HANG=1` + `contentTracing`（类别 `disabled-by-default-v8.cpu_profiler`）——
  tracing 服务独立于渲染主线程，忙死时也能采样；trace 留存 `%TEMP%\gitter-trace.json`。
  两轮直方图：无样式时 `transitionend` 16,140 次/10s + React 事件分发（`ao`）64,560 次10s；
  带样式后 84% 样本在宿主 bundle `Qc`（React 提交）+ viewer 网格 painter `Bbs`，
  Blink `ShapeText` 5.1 万次——虚拟化器在向 React 提交海量单元格 DOM；
- `GITTER_SHOT_PREPARE_JS` + MutationObserver + console 转发：挂载 45s 后 viewer 内
  **206,499 个 DOM 节点**、1.5s 内 22 万次变更；`.xv-shell` scrollHeight 16,466,169px
  （= 全表 1,048,576 行 × 15.7px，Excel 语义下正常）但虚拟窗口失控；
- **裸环境复现**：`%TEMP%\xlsx-lab.html`（CDN esm.sh + react 18.3.1 + xlsx-react-viewer 0.1.0，
  零 Gitter 代码）——挂载 3.4s 后心跳停摆。**结论：上游组件自身缺陷，与 Gitter 集成无关**。

**上游现状**（2026-10-10）：npm 仅 `0.0.0-stage` / `0.1.0`；`exports["./styles.css"]` 指向**不存在**
的 `dist/xlsx-viewer.css`（Tailwind v4 工具类写法，要求消费方自行编译——`web/scripts/compile-xlsx-css.mjs`
已实现该编译并验证）；仓库实为 **SEMOSS/xlsx-viewer**（README 里的 SEMOSS/excel-viewer 404），
单 commit（2026-10-01）、无 issues、无修复版。

**处置（降级而非硬扛）**：

- `OfficePage` 的 xlsx 分支改派 `XlsxUnavailable`（officeXlsx.tsx）说明卡 + 一键 `shell.openPath`；
  ExcelViewer 包装移入 `officeXlsxViewer.tsx`（不在组件图内，树摇后 page.js 13.63MB → **11.84MB**）；
- 新增 i18n：`Office_XlsxTitle` / `Office_XlsxBody`；`Office_PhaseNote` 文案改为
  「PPT / Word 页内编辑；xlsx 暂用外部程序打开」；
- 保留资产：`compile-xlsx-css.mjs` + `xlsx-tailwind-input.css`（Tailwind v4 编译，`@theme inline`
  把 19 个语义 token 解析到 `--xlsx-*` 运行时变量）、`officeXlsxViewer.tsx`（theme 模块级冻结 +
  memo 经验写在头注）；
- 恢复挂载的三步回归清单在 `officeXlsxViewer.tsx` 头注；触发点见 §8.1。

**处置后验证**：xlsx 点击 → 说明卡渲染正确、主线程漂移 61ms（空闲）；docx 62ms / pptx 64ms
不回归；boot-check PASS（18149ms）、权限 E2E PASS、三格式二进制通道往返 ALL PASS。

### 9.10 pptx 打开整页崩溃修复（2026-10-10 傍晚）

**用户反馈「ppt 无法打开」**：点击 .pptx → 整页崩溃
`Cannot read properties of undefined (reading 'resources')`（PageErrorBoundary 接管）。
复盘中发现此崩溃**自 Phase 1 起就存在**——此前截图验收只验了空态与文件列表、
漂移探针测不出 React 崩溃（错误边界接管后界面仍"空闲"）， 属于验收盲区；
`GITTER_SHOT_CLICK` 截图必须与漂移探针同看。

**根因**：`pptx-react-viewer` 的标题栏语言选择器用 `useTranslation()` 的全局 i18next
实例读 `i18n.options.resources`，并假定**宿主应用已初始化 i18next**。Gitter 宿主不用
i18next → react-i18next 的 `getI18n()` 返回空 → 警告
`You will need to pass in an i18next instance by using initReactI18next` → 选择器读
`.options.resources` 抛 TypeError。docx/xlsx viewer 不走 react-i18next，不受影响。

**修复**（`web/src/pages/officePptx.ts` 模块装载时幂等初始化）：

```ts
i18next.use(initReactI18next);
if (!i18next.isInitialized) { void i18next.init({ lng, fallbackLng: "en",
  supportedLngs: ["en", "zh-CN"], resources: { en: { translation: translationsEn },
  "zh-CN": { translation: {} } }, interpolation: { escapeValue: false },
  react: { useSuspense: false } }); }
```

两个坑：① i18next 实例构造完成时 `options` 即为 `{}`（truthy）——幂等判定必须用
`isInitialized`，用 `options` 判定会永远跳过 init；② chrome 文案走 react-i18next 的
`t()`，必须注册 viewer 自带词表 `translationsEn`（ooxml-ui/pptx/i18n，3991 键）为
`en.translation`——LOCALE_CATALOG 宣称 fr/es/de/zh-CN，但 npm 包只携带英文词表，
故 pptx chrome 为英文（docx viewer 自带中文词表，chrome 为中文）。

**修复后**：pptx 打开完整 PowerPoint 式编辑器（功能区/幻灯片画布/属性面板/状态栏，
英文 chrome），主线程漂移 61ms；docx 62ms（中文 chrome）；xlsx 说明卡 62ms；
boot-check PASS（18059ms）、权限 E2E PASS、三格式往返 ALL PASS。

---

## 10. 方案 v3：预览-only（2026-10-10 定稿，当前有效方案）

> **决策**：Gitter 内只做**预览**（render-only），**编辑一律交给外部应用**（`shell.openPath`，
> 已有通道）。本节取代 §4 的 v2 集成方案；§0–§3 的调研结论保留作历史参考，
> 其中「成熟度」判断已被 §9 的实测推翻。

### 10.1 切换理由（实测记录，非假设）

v2 的页内编辑路线在一天内连续触发三类事故，均为该依赖族群的结构性问题，非个例 bug：

| 事故 | 现象 | 根因层级 |
| --- | --- | --- |
| xlsx 冻结（§9.9） | 挂载即渲染风暴，主线程彻底饿死，内存 1GB+/4s | 组件虚拟化器失控（裸 HTML + CDN 复现，与宿主无关） |
| pptx 崩溃（§9.10） | 点击 .pptx 整页崩溃 `reading 'resources'` | 组件假定宿主初始化 i18next——隐式宿主契约 |
| **侧边栏动效丢失（§10.1）** | office 页打开后 `.main` 折叠过渡从 300ms 变 1e-05s，瞬变 | **vendor CSS 注入宿主文档**：pptx-viewer.css 携带完整 Tailwind v4 Preflight（`html,:host{font-family:...}`、`*,:after,:before{box-sizing:border-box;border:0 solid;margin:0;padding:0}` 等全局 reset 随页面包 `<style>` 进入宿主） |

第三条是压垮方案的结构性问题：**把第三方 viewer 挂进宿主文档，其 CSS 必然与宿主共 cascading
环境**。实测复现（`GITTER_SHOT_PROBE_JS` 探针）：office 页挂载 pptx 前
`.main` computed transition 为 `grid-template-columns 0.3s cubic-bezier(.2,0,0,1)`（80ms 中间帧
81px，动画中）；挂载后变 `1e-05s`（折叠瞬变）。修复它需要逐包审计注入 CSS 的作用域——
这是无底洞，且每个新版本都可能回归。

**结论**：页内「编辑器级」组件的集成成本（稳定性 + CSS 隔离 + 隐式契约 + 维护面）
远超收益；常用格式的编辑需求由用户自己的 Office/WPS/LibreOffice 承担（外部打开已是
成熟通道）。Gitter 退守**预览**，用成熟的 render-only 库 + 文档级隔离。

### 10.2 新范围

**做**：

- 预览：`.pdf` `.docx` `.pptx`（试做）`.xlsx` `.xlsm` `.ods` `.csv` `.tsv`，
  在 office 页右侧预览区渲染；
- 预览必须**文档隔离**（§10.5），任何预览库的 CSS/JS 异常不得波及宿主；
- 文件列表 UI、OOXML 白名单二进制读通道（`file.readBinary`，§5 已建成）原样复用；
- 顶栏「用外部程序打开」升级为全格式主操作（编辑入口）；
- 图片（`.png` `.jpg` `.gif` `.webp` `.svg` `.bmp`）与纯文本由 Files 页既有通道承载，
  office 页不重复建设；若要统一入口，`<img>`/`<pre>` 兜底成本≈0（实施时顺手项）。

**不做（下线）**：

- 页内编辑、保存链路（`file.writeBinary` 的页面侧调用、mtime 冲突弹窗、Ctrl+S 转发、
  `Office_Save*`/`Office_Conflict*` 文案与 UI）。桥通道本身保留——agent 侧仍在用；
- 三个 viewer 组件及其依赖（`pptx-react-viewer` `pptx-viewer-core` `docx-react-viewer`
  `xlsx-react-viewer` `xlsx-viewer-core` `i18next` `react-i18next`、Tailwind 编译脚本、
  `framer-motion`/`jspdf`/`jszip`/`lucide-react` 等随之树摇）；
- 无成熟纯前端渲染方案的格式，维持「列表展示 + 外部打开」：`.doc` `.xls` `.ppt`（旧二进制）、
  `.odt` `.odp`（OpenDocument 文字/演示——JS 侧无成熟渲染器；`.ods` 表格例外，SheetJS 可读）、
  `.rtf`、Apple 三件套（`.pages` `.key` `.numbers`）。

### 10.3 候选矩阵（2026-10-10 npm 实测数据）

| 格式 | 库 | 版本 | License | 周下载 | 维护状态 | 定位 |
| --- | --- | --- | --- | --- | --- | --- |
| pdf | **pdfjs-dist**（Mozilla） | 6.x | Apache-2.0 | 3212 万 | 官方维护 | **首选**：canvas 渲染 + 文本层，事实标准 |
| docx | **docx-preview**（[VolodymyrBaydalka/docxjs](https://github.com/VolodymyrBaydalka/docxjs)） | 0.4.1（2026-09-21） | Apache-2.0 | 187 万 | 活跃，32 个版本 | **首选**：版式保真渲染到 DOM（分页/表格/图片/页眉页脚） |
| docx | mammoth | 1.13.0 | BSD-2 | 1008 万 | 活跃 | 备选：语义化 HTML，**丢版式**，仅作 docx-preview 的保底 |
| xlsx / .ods | **SheetJS CE（`xlsx`）** | 0.18.5（冻结） | Apache-2.0 | 1270 万 | 解析极稳，社区事实标准 | **首选（解析）**：`sheet_to_html` 出表格（ODS 读取同通道），样式自绘 |
| xlsx / .ods | @e965/xlsx（SheetJS 社区续作） | 0.20.3（2024-07） | Apache-2.0 | 92 万 | 持续跟进上游 | 首选的替换件：SheetJS 停更风险触发时无缝切换 |
| xlsx | exceljs | 4.4.0 | MIT | 1772 万 | 活跃 | 备选解析器（流式读大表；不读 ODS） |
| csv / tsv | PapaParse | 5.7.0 | MIT | 1646 万 | 活跃 | 可选；csv/tsv 无格式，自研分割 + 自绘表格即可，库非必需 |
| pptx | **pptx-preview** | 1.0.7（2025-10-17） | ISC | 16 万 | 唯一专用渲染器 | **谨慎**：文本框/图片级保真，动画/SmartArt/主题不完整 |
| 旧格式 .doc/.xls/.ppt；.odt/.odp；.rtf；Apple 三件套 | — | — | — | — | — | 纯前端无成熟方案，**外部打开** |
| ~~xlsx~~ ~~docx~~ ~~pptx~~ ~~编辑~~ | ~~ChristopherVR/ooxml 三件套~~ | — | — | — | §9 三起事故 | **废弃**（编辑需求由外部应用承担） |

> pptx 是唯一没有成熟开源方案的格式。诚实预期：pptx-preview 的渲染质量是「内容可读」
> 级（文本+图片+简单形状），不是 PowerPoint 级。P2 人工验收不达标就把 pptx 也归入
> 「列表 + 外部打开」——**不为 pptx 重演一次 v2 的沉没成本**。

### 10.4 分格式决策

| 格式 | 预览方案 | 编辑 |
| --- | --- | --- |
| .pdf | pdfjs-dist：canvas 渲染（缩放/翻页），worker 内联（复用 Monaco 的 `?worker&inline` 先例） | 外部打开 |
| .docx / .docm（试） | docx-preview（iframe 内渲染） | 外部打开 |
| .xlsx / .xlsm / .ods | SheetJS 解析 → 每工作表一个 HTML 表（自绘样式，含列宽/合并单元格/数字格式） | 外部打开 |
| .csv / .tsv | 内置解析（或 PapaParse）→ 同 xlsx 表格视图（分隔符自适应/固定制表符） | 外部打开 |
| .pptx / .ppsx | P2：pptx-preview 试做，人工验收保真度；不达标 → 列表 + 外部打开 | 外部打开 |
| .txt / .md / 代码文件 | Files 页既有通道承载（Monaco），office 页不做 | 外部打开（Monaco 亦可编辑） |
| .png / .jpg / .gif / .webp / .svg | Files 页既有通道承载；office 页统一入口时 `<img>` 兜底 | 外部打开 |
| .doc / .xls / .ppt / .odt / .odp / .rtf / .pages 等 | 不预览 | 外部打开 |

### 10.5 架构：预览必须文档隔离

v2 的核心教训是注入 CSS 污染宿主（§10.1）。预览-only 方案把「隔离」定为一等约束：

**主案：iframe 隔离**

- 每个预览渲染进独立 `<iframe>`（`srcdoc` 或 Blob URL）。预览库与全部样式只存在于
  iframe 文档内——**无论库往 `document.head` 塞什么、无论它抛什么异常，宿主文档零污染**；
- iframe 壳是页面包自产的静态 HTML（内联打包好的预览库 + 少量挂载脚本），数据经
  `postMessage` 注入 base64 字节；
- 宿主侧只保留：列表、顶栏（文件名/大小/外部打开按钮）、iframe 容器、错误兜底卡
  （iframe 内 `onerror` → postMessage → 宿主显示「预览失败」+ 重试/外部打开）；
- CSP：iframe 文档需要内联脚本（打包产物 + 挂载脚本），实施时评估对 iframe 场景
  放宽 `script-src 'unsafe-inline'`（或按内容 hash 加白）——这是新方案唯一可能触碰
  CSP 的点，其余不变（预览库无网络请求，`connect-src` 不动）。

**备选：Shadow DOM**（`attachShadow` + 预览渲染进 shadowRoot）——实现更轻，但只能隔离
选择器作用域：库若运行时向 `document.head` 注入 `<style>`（Tailwind 系常见）仍会穿透，
`font-family` 等继承属性也会漏。**仅当 iframe 方案被证伪时再评估**，且入库前必须过
§10.7 的注入审计。

### 10.6 实施阶段

- **P1（pdf + docx + xlsx/ods + csv/tsv）**：iframe 预览壳；`file.readBinary` 白名单从
  OOXML 九扩展扩到 `.pdf` `.ods`（csv/tsv 走既有文本通道）；pdfjs-dist（worker 内联，
  复用 Monaco `?worker&inline` 先例）+ docx-preview + SheetJS 表格视图（xlsx/xlsm/ods
  同一渲染层）+ 内置 csv/tsv。office 页骨架（列表/顶栏/外部打开）保留改造。
- **P2（pptx 试做）**：pptx-preview 接入同一 iframe 壳；真实 pptx 样本人工验收
  （文本/图片/多页/字体），不达标即把 pptx 归入「列表 + 外部打开」并关闭该方向。
- **收尾**：删除三个 viewer 依赖与 Tailwind 编译脚本；`page.js` 预期从 11.84MB 降到
  ~3–4MB（pdfjs ~1MB + SheetJS ~900KB + docx-preview ~200KB，均懒加载可再压）；
  `Strings.tsv` 清理 `Office_Save*`/`Office_Conflict*`/`Office_TooLarge` 等编辑态文案。

### 10.7 验收清单（每条都必须自动化或双确认，吸取 §9 教训）

- [ ] **宿主零污染**：office 页挂载 + 打开各格式预览后，
      `getComputedStyle(.main).transitionDuration` 仍为 `0.3s`（折叠动画不回归）；
      `document.head` 中新增 `<style>` 不含 `html,:host`/`*{box-sizing` 等 Preflight 特征；
- [ ] **主线程健康**：打开/关闭/重开预览 20 次，50ms 定时器漂移 < 100ms，无内存爬升；
- [ ] **崩溃隔离**：向 iframe 注入抛异常的挂载脚本，宿主页面正常、显示兜底卡；
- [ ] 每格式一个真实样本（非引擎生成）截图验收：pdf 多页+中文嵌入字体+图片；docx 分页/
      表格/页眉页脚；xlsx 多表/合并格/数字格式；ods 与 xlsx 同样本对照；csv/tsv 中文/
      引号转义/分隔符自适应；pptx 若做 P2 加验文本框/图片/多页；
- [ ] 大文件边界：50MB 白名单上限提示（复用现有 `truncated` 语义）、SheetJS 对 10MB 级
      xlsx 解析耗时 < 3s、pdfjs 对 20MB 级 pdf 首页渲染 < 2s；
- [ ] 权限不回归：预览只读 `file.readBinary`（git.read），页面 manifest 可下修
      `git.write` 权限声明；boot-check / 权限 E2E 全绿。

### 10.8 风险与复评触发

- **pptx 保真度不达标**（预期概率高）→ P2 直接关闭该方向，无沉没成本；
- **docx-preview 复杂版式近似**（艺术字/文本框环绕/复杂域）→ 预览定位可接受，README
  的 limitations 页有明确清单；
- **pdfjs worker 与 CSP**：worker 代码内联为 base64 blob（Monaco 先例），不放宽
  `worker-src`；若 Firefox 特有路径出问题仅影响非 Electron 场景，Electron 恒为 Chromium；
- **SheetJS CE 停更**（0.18.5 已冻结）→ 解析器切 `@e965/xlsx`（接口兼容）或 exceljs，
  渲染层无感；ODS 读取在 SheetJS/@e965 两边都有，exceljs 不支持——切 exceljs 时 ODS
  需保留 SheetJS 单独处理；
- **iframe + srcdoc 的 CSP 细节**（内联脚本授权）→ 实施首个任务，若不可行退回
  「Shadow DOM + 注入审计」备选案；
- 复评触发点：pdfjs-dist / docx-preview / pptx-preview / @e965-xlsx 任一发布破坏性大版本，
  或出现更好的保真渲染器（对照 §8.2 竞争项目清单）。

### 10.9 实施回填（P1 + P2，2026-10-10 晚）

按本节方案落地为 commit 2（此前 commit 1 已下线 v2 编辑套件、收敛为骨架）。

**实现**：

- iframe 运行时：`web/src/pages/officePreview/`（runtime.ts 协议入口 +
  renderPdf/renderDocx/renderSheet/renderPptx 四渲染器 + iframeCss.ts iframe 内样式 +
  virtual.d.ts）。协议：`ready → render{id,renderer,name,dark,base64|text} → done|error`，
  宿主 30s 超时兜底；iframe `sandbox="allow-scripts"`（opaque origin）。
- 双阶段构建：`build-pages.mjs` 先把运行时单独构建为 minified IIFE，经
  `virtual:officePreviewRuntime` 内联进 office 页 page.js；`</script` 转义防提前闭合。
- 宿主 OfficePage：列表（含 legacy 格式，徽标 PDF 红/表格族绿）→ 顶栏（体积/页数/外部打开）
  → iframe 容器 + 加载态 + 失败兜底卡（重试/外部打开）。csv/tsv 走 `file.content` 文本通道，
  其余走 `file.readBinary`；treex 白名单扩 `.pdf` `.ods`（`isBinaryDocPath`）。
- CSP（web/index.html）：`script-src 'self' 'unsafe-inline' blob:` + `worker-src blob:` +
  `img-src blob:`（srcdoc 继承宿主 CSP，内联脚本与 blob worker 必需；connect-src 不动）。
- 依赖 4 个：pdfjs-dist 6.4.299 / docx-preview 0.4.1 / xlsx 0.18.5 / pptx-preview 1.0.7。

**实测发现（都进了实现）**：

- **沙箱 iframe 内 module worker 被 Chromium 拒绝**（`Refused to cross-origin redirects of
  the top-level worker script` → pdf.js 静默回退 fake worker 拖累宿主主线程）。实测
  classic worker 可用：把 pdf.worker.min.mjs 整形（尾部 `export{...}` 剥除——同行已赋值
  `globalThis.pdfjsWorker`；WASM 桩内 `import.meta.url` → `self.location.href`）后经
  `GlobalWorkerOptions.workerPort` 挂 classic blob worker（renderPdf.ts）。
- **截图 harness 两类竞态**（main.ts shotRepo 钩子）：openRepo 的完成回调会把页面设回
  log——发早了被 boot 恢复（settings.currentProjectPath）覆盖、发晚了把 shotPage 导航
  扯回 log。定版：did-finish-load + 5s 延迟发送。
- xlsx-react-viewer 时代生成的 `测试表格.xlsx` 实为空工作簿（`<sheetData/>`）——SheetJS
  判空正确，非兼容缺陷；富内容路径由 SheetJS 自产 4 表样本验证。

**验收（§10.7 对照，GITTER_SHOT harness）**：

- [x] 宿主零污染：pptx/pdf 预览打开后 `getComputedStyle(.main).transitionDuration` =
      0.3s（不变），head `<style>` Preflight 特征 0 命中（PROBE_JS 探针）；
- [x] 主线程健康：全格式打开定时器漂移 54–63ms（空闲）；1.5MB ESP32 原理图 PDF
      （复杂矢量）经 classic worker 渲染完整保真、无 fake worker 回退；
- [x] 崩溃隔离：`corrupted.docx`（假 zip）→ iframe 内异常捕获 → postMessage →
      「预览失败」兜底卡 + 重试/外部打开，宿主无恙；
- [x] 每格式真实样本截图：pdf（合成 2 页 + ESP32 原理图）、docx（中文正文分页）、
      xlsx/ods（同工作簿 4 表：列宽/合并/中文/空表，数字右对齐）、csv（引号转义/中文）、
      pptx（标题/内容页，§10.3 预期的「内容可读」级保真——P2 保留，不砍）；
- [x] 暗色管道：`data-base=dark` → iframe `body.dark` 背板切换（文档本体恒白纸）；
- [x] 权限：manifest 只声明 `git.read` + `window`；boot-check PASS、权限 E2E PASS；
- [x] 体积：office page.js = 3.56MB（minified，含内联 worker），§10.6 预期 3–4MB ✓。
- [ ] 待人工验收：20× 打开/关闭循环漂移、50MB 二进制 / 8MB csv·tsv 边界提示、
      10MB 级 xlsx 解析耗时、20MB 级 pdf 首页耗时、pptx 复杂真实样本保真度终审；
- [ ] 已知良性噪音：开 ELECTRON_ENABLE_LOGGING 时偶见一条 `Uncaught SyntaxError:
      Missing initializer in const declaration @ index.html (9)`——不命中主帧 onerror、
      不影响任何渲染/断言，来源未定位（疑为沙箱帧/worker 错误归因），持续观察。

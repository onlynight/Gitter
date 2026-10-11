# 页面包重资产拆分方案（GITTER_LIBS 库机制）：Monaco 库化 + office 预览运行时动态依赖

> 状态：✅ 全部实施完成（2026-10-12，S1–S4 + S5 chart 库化）
> 关联：`ui-full-pluginization-plan.md`（页面包链路/D2 KIT 先例/§八依赖图裁决）、`inline-editor-plan.md` §2.2/§6.2（被推翻的"页面私有依赖"旧裁决）、`office-integration-plan.md` §10.5（iframe 预览安全模型，保持不动）

---

## 0. 问题定性（为什么此前合在一起）

`inline-editor-plan.md` §2.2 旧裁决「Monaco 作为页面私有依赖，不 external」的三条理由（非 React 单例、worker 体系、CSS 独立）只否定"走 GITTER_KIT 共享"，不否定"独立成包"；真正原因是**单文件装载器约束**——pageLoader 只注入 entry + styles，vite lib 构建拆出的 CSS/worker 产物装载器装不了，整包内联是阻力最小路径（文档自记"真分包列为后续优化"，§7 P4）。office 预览运行时同理：iframe srcdoc 需要 JS 字符串，构建期经 `virtual:officePreviewRuntime` 内联最省事，代价是 **3.5MB 在 gitui.page.office 与 gitui.page.files 重复两份**。

拆分前实测：gitui.page.files/page.js 16MB（Monaco ~12MB + office 运行时字符串 ~3.5MB + 页面自身 ~0.3MB）、gitui.page.office/page.js 3.5MB（几乎全是运行时字符串）。

## 1. 目标架构

```
pageLoader.injectPackage(m)
  ├─ ① 依赖解析：m.dependencies → store 解析（缺提供方/semver 不满足 → ok=false）
  ├─ ② 依序注入库 entry 脚本（幂等 + 并发去重；caller 窗口之外——库不做 RPC）
  │      库脚本同步挂 window.GITTER_LIBS.<id> → onload 后断言存在（2s 超时）
  ├─ ③ 全部依赖就绪后注入页面 entry（页面同步取 GITTER_LIBS.*，= import 提升语义）
  └─ 页面卸载时库不卸载（与 KIT 同语义：库是单例，驻留复用）

window 面：GITTER_KIT（宿主组装，React/内核组件，不可替换）
         + GITTER_LIBS（包组装，重资产库，独立版本/独立启停）
```

## 2. 机制设计

### 2.1 manifest（schemaVersion 2 内扩字段，向后兼容）

```jsonc
// gitui.lib.monaco/manifest.json（新库包）
"contributes": { "libraries": [
  { "id": "monaco", "version": "0.52.2", "entry": "monaco.js", "global": "GITTER_LIBS.monaco" } ] }

// gitui.page.office（officeview 库贡献 + 页面自依赖）
"pages[0].dependencies": [{ "lib": "officeview", "package": "gitui.page.office" }]
"contributes.libraries": [{ "id": "officeview", "version": "1.0.0", "entry": "officeview.js", "global": "GITTER_LIBS.officeview" }]

// gitui.page.files（跨包依赖 + semver 区间）
"pages[0].dependencies": [
  { "lib": "monaco", "package": "gitui.lib.monaco", "semver": "^0.52.0" },
  { "lib": "officeview", "package": "gitui.page.office" } ]

// S5 可选依赖（required 缺省 true）：chart 缺席只降级 pptx 图表幻灯片，
// 不阻塞页面装载、不触发依库停用守卫
"pages[0].dependencies": [
  ...,
  { "lib": "chart", "package": "gitui.lib.chart", "required": false } ]
```

- 库声明**不带 permissions**：库脚本不做 RPC，loader 在 caller 窗口之外注入。
- store.pagesOf() 每页附带 `dependencies` 解析结果（lib/packageId/entryAbs/version/global/ok/reason/required），bridge `extensions.pages` 原样透传——单 RPC 原子取齐。
- loader：`ok=false && required=false` → console 记录后跳过（降级装载）；其余失败照常阻塞页面装载。

### 2.2 关键裁决

| # | 裁决 |
|---|---|
| D1 | 库提供方限内置包（v1，store.libraryIndex 按 isBuiltIn 过滤）；消费方向所有页面开放。不做任意插件间依赖图（ui-full-pluginization §八原裁决延续——库是"窄而声明式"的单向一层依赖） |
| D2 | 注册用哑全局 `GITTER_LIBS.<id>`，不做 registerLibrary 握手；loader onload 后断言 global 存在 |
| D3 | **依赖先于页面执行，页面同步取用**（= import 提升语义，页面代码零等待逻辑） |
| D4 | officeview 是**字符串资产库**不是可执行库——iframe srcdoc 静态拼装、opaque origin、postMessage 握手原样不动（office-integration §10.5 安全模型），只换字符串来源；取值延迟到 PreviewFrame 首渲染（缺库异常落渲染期 → 槽位 ErrorBoundary 错误卡，不静默半死） |
| D5 | 版本契约 = manifest version + 页面 semver 区间，不满足即装载失败（诚实呈现）；monaco 库 manifest version 与 web/package.json 双点一致由 build-pages.mjs buildMonacoLib 断言 |
| D6 | 库不卸载（与 page.js/KIT 同语义） |
| D7 | **chart 是 officeview 的可选增强（required:false），不是 loader 级硬依赖**：echarts 全量（~1MB，sideEffects 声明含 index 与全部 chart/component 注册文件，命名空间导入即全量入包）为 pptx 内嵌图表幻灯片服务（`init(el,null,{renderer:"svg"})` 唯一命名空间用法）；缺席时 echartsStub 委托抛错 → renderPptx catch → 文档级错误卡，pdf/docx/xlsx 与无图表幻灯片零影响。officeview→chart 是 srcdoc 字符串组合（`srcdocScripts()`），不违反 §7"库不依赖库"（无 loader 级解析） |

### 2.3 依库停用守卫（D4 守卫的库扩展）

`PackageStore.dependentPagesAfterDisable(packageId)`：假想 packageId 的库贡献全部失效（整包停用或 libraries kind 单独停用）后，**其他**已启用页面包将失去的依赖库列表；页面依赖自身包的库不算（同生共死，无孤儿）；`required:false` 的可选依赖不算（缺席只降级，S5）。bridge 三处接入：`extensions.setEnabled` / `extensions.setKindEnabled("libraries")` / `extensions.uninstall`——非空即拒绝并以此作为原因。

## 3. 三个包的拆分

| 包 | 前 | 后 | 说明 |
|---|---|---|---|
| gitui.page.files/page.js | 16MB | **184KB** | 纯页面自身代码；monaco-editor 经构建期 alias（`^monaco-editor$` → src/external/monacoLibAccess.ts）投影到库全局，页面源码保持 `import * as monaco from "monaco-editor"` 零改动（tsc 走 node_modules 真实类型） |
| gitui.lib.monaco/monaco.js | — | **12.0MB** | Monaco 全量（editor.main + basic-languages + 四语言服务）+ 五 worker `?worker&inline`（base64/Blob URL）+ CSS 自注入（monacoCssInline 插件从页面构建迁来）；入口 web/src/libs/monacoLib.ts 挂 GITTER_LIBS.monaco |
| gitui.page.office/page.js | 3.5MB | **26KB** | 纯页面壳 |
| gitui.page.office/officeview.js | — | **2.4MB**（S5 前 3.5MB） | 预览运行时字符串唯一副本（wrapper: `GITTER_LIBS.officeview = { version, runtimeJs, srcdocScripts() }`）；S5 起 echarts 经构建期替身（echartsStub.ts）剥离，`srcdocScripts()` 把 chart 运行时组合在预览运行时之前；`virtual:officePreviewRuntime` 退役 |
| gitui.lib.chart/chart.js | — | **1.0MB**（S5 新增） | echarts 全量（含 SVG 渲染器）字符串资产 wrapper（`GITTER_LIBS.chart = { version, runtimeJs }`）——echarts 本体只在 iframe 预览文档内执行（挂 `self.GITTER_CHART`），宿主文档零字节执行；echarts 已在 web/package.json 显式入账（原为 pptx-preview 传递依赖） |

磁盘总量 19.5MB → 16.6MB（消除 2×3.5MB 重复后净减 3.5MB，S5 chart 独立化回填 +1.0MB 唯一副本）。页面包 minify 例外随之取消（`minify: false` 全量回归缺省策略——重资产已拆出，页面回归纯自研代码，安全网行号恢复有意义）。

## 4. 生命周期

- **懒装载**：库随依赖页首次导航注入（loadedLibs 按 `packageId:lib` 幂等，injectingLibs 并发去重——files/office 同时首导航 officeview 只注入一次）。
- **热重载**：doLoadExternalPages 差量同步对库做同样处理——清单里消失的库（提供方停用/卸载）与 entryAbs 变更的库从已装载账本剔除；依赖解析结果变化（depsChanged）视同包内容更新 → 依赖页强制重装载。
- **失败路径**：依赖解析失败（ok=false）/库脚本注入后 global 未注册（2s 超时）→ doInjectPackage 抛错 → markLoadFailed → 槽位错误卡，原因带依赖库名与区间。

## 5. 验收记录（2026-10-12 全绿）

- **smoke-ui-runtime** 新增 e) 库机制 8 断言：依赖解析（provider/entryAbs/global 透出）、D1 用户包同 id 库忽略、semver 不满足 ok=false 带区间、无提供方/钉错包 ok=false 点名、依库停用守卫（两依赖页同点名/自依赖不算/libraries kind 单独停用解析失败）+ d) 静态守卫 2 断言（loader 库先行装载序、依赖失败原因冒泡）。
- **smoke-ui-pages** 新增 d) 重资产拆分产物 9 断言：库贡献齐备（monaco→gitui.lib.monaco、officeview→gitui.page.office）、monaco 版本双点一致、files/page.js 零 MonacoEnvironment/pdfjs 标记且 ≤1.5MB（实测 183KB）、monaco.js 含 worker 装配 + GITTER_LIBS 注册（12.0MB）、officeview wrapper 形状（3.5MB）、office/page.js 零运行时标记（26KB）、files 依赖 2 项与 office 自依赖 1 项经真实包扫描解析全 ok。
- **全量冒烟**：smoke / smoke-extensions / smoke-u2 / smoke-seams-bc / smoke-seams-def / smoke-ui-runtime / smoke-ui-pages 全绿；smoke-seams-f 在 HEAD 上同样失败（L2 循环注册，既有问题与本次无关）；e2e-pages-check 在 HEAD 上同样失败（本机 electron 实例占用环境，既有问题）。
- **harness 实机（浏览器）**：files.html 装载 monaco/officeview 两库 → 页面挂载 → 快速打开 app.ts → 编辑器实例创建 + 140ch 模型 + 语法高亮 + 编辑上屏 + 树内脏标记 + TS 诊断计数 + `__applyTheme('light')` 后 editorBg 变白（defineTheme 重应用）。
- **check-page-imports** 扩 2 条：禁止 monaco 深导入（`monaco-editor/(esm|min)/`——worker/CSS 归库构建）、禁止 `virtual:` 内联导入。

## 6. 升级 Monaco / echarts 的动作（本方案的动机验收）

1. web/package.json 改 `monaco-editor`（或 `echarts`）版本；
2. 同步对应库包 manifest `contributes.libraries[0].version`（gitui.lib.monaco / gitui.lib.chart——不改会被 build-pages.mjs 断言拦下）；
3. `cd web && npm run build` —— 只重建对应库包产物，files/office 页产物零重建。
4. smoke-ui-pages 的版本双点断言兜底校验（echarts 对 node_modules 实际版本断言）。

> echarts 升级注意：pptx-preview 对 echarts 命名空间只有 `init` 一个用法（SVG 渲染器），
> echartsStub 导出面按此铺；升 pptx-preview/echarts 后若 rollup 报"缺命名导出"，
> 在 echartsStub.ts 补铺（web/scripts 曾有一次性分析脚本核对用法面，可随时重建）。

## 7. S5 实施记录（2026-10-12：chart 库化 + 可选依赖）

- **背景**：S2 收敛后 echarts（~1MB）仍随 officeview 唯一副本整装随行。用途面核实：
  pptx-preview dist 对 echarts 命名空间仅 `h.init(e,null,{renderer:"svg"})` 一处调用
  （图表幻灯片渲染，setOption/dispose 走实例方法）；echarts sideEffects 声明
  （index + 全部 chart/component 注册文件）使命名空间导入即全量入包，无法摇除。
- **拆分**：新建 `gitui.lib.chart`（字符串资产库，同 officeview 语义）——
  `src/libs/chartLib.ts`（iframe 内挂 `self.GITTER_CHART`）→ buildChartLib 产
  chart.js wrapper；officeview 构建挂 `^echarts$` → `echartsStub.ts`（惰性委托
  self.GITTER_CHART，导出面 = pptx-preview 实际用法 init/use）；wrapper 增
  `srcdocScripts()`（chart 在前、预览运行时在后，chart 缺席自动降级）。
- **机制扩展**：`dependencies[].required`（缺省 true）——schema zod + 类型 + 序列化、
  store.pagesOf 解析透传、loader `ok=false && required=false` 跳过降级、
  依库停用守卫跳过可选依赖。files/office 两页 manifest 声明
  `{lib:"chart", package:"gitui.lib.chart", required:false}`。
- **验收**：smoke-ui-pages d) 增 5 断言（chart 库贡献/版本双点/stub 剥离标记/wrapper 形状/
  可选依赖解析 + 守卫不触发）全绿；smoke-ui-runtime 增 e2) 可选依赖 4 断言（缺席
  ok=false+required=false、required 缺省 true、守卫不触发、loader 静态降级分支）+
  d) 静态断言 1 条全绿；web 构建（tsc+vite+build-pages）全绿；smoke / smoke-extensions /
  smoke-u2 / smoke-seams-bc / smoke-seams-def 全绿。产物：officeview 3.5→2.4MB、
  chart.js 1.0MB、files/page.js 194KB。

## 8. 明确不做

- 库不依赖库（依赖图只有"页面→库"一层；officeview→chart 是 srcdoc 字符串组合 + 页面 required:false 声明，非 loader 级库间解析，D7）。
- 不做用户包提供库（v1，D1）。
- 不动 iframe srcdoc 安全模型（D4）。
- 不做 monaco 按语言分包（inline-editor §6.2 遗留项，与拆包正交；IIFE 内联 base64 worker 无法懒载的结论维持）。
- 不做库级热替换/卸载（D6）。
- 不做 echarts 按图表类型 tree-shake（echarts/core + 按需注册可再省 ~0.4MB，但图表类型取决于 pptx 内容，全量是稳健选择；独立成包后升级/收窄只动一个包）。

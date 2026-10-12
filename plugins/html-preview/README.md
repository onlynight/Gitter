# HTML 预览（外部 L2 插件）

Gitter 第二个**外部**代码插件：经 `file.preview` 的 previewProviders 接缝接管 `.html`/`.htm` 预览，
插件零依赖、原文透传，渲染端放入 `sandbox="allow-scripts allow-forms allow-modals"`（无
`allow-same-origin`）iframe——脚本可执行但源为 opaque，读不到宿主页面/文件系统/Cookie。
与 Markdown 预览（`html:false` 静态标记 + `sandbox=""`）的安全档位差异由文档性质决定：
HTML 的脚本/样式本身是文档的一部分。

## 消费点

- **文件页**：点击 `.html`/`.htm` → 编辑器画布显示预览；路径条（面包屑）最右侧「编辑源文件」
  切 Monaco 文本，「预览模式」切回（与 Markdown 预览/编辑同一对按钮）。
- **任务面板**：任务改动 `.html` → 文件 tab 预览模式显示渲染结果；无插件时回退卡可跳内置编辑器。

## 构建与安装

```bash
node plugins/html-preview/build.mjs --install
```

- 打包 `src/main.ts` → 单文件 CJS `main.js`（零第三方依赖，宿主零新增依赖；esbuild 从
  `web/node_modules` 解析）；
- 复制 `manifest.json` + `main.js` → `%APPDATA%/<gitter-app|Gitter>/packages/com.gitter.html-preview/`。

## 启用（信任门）

1. 应用内 设置 → 扩展 → 打开 **「允许代码插件」**（`settings.allowCodePlugins`，默认关）；
2. 重启或切换该设置触发 `extensions.changed` → 宿主 `activateAll` 装载 entry → provider 注册；
3. 打开任意 `.html` 验证：预览渲染（含脚本/样式）、`设置 → 扩展` 列表出现「HTML 预览」（可启停）。

## 已知边界

- 相对路径子资源（`src="a.png"`、`href="style.css"`）在 opaque 源沙箱中不可加载，仅
  http(s) 外链资源与内联样式/脚本生效——与 Markdown 预览的相对图片同一限制。

## 卸载

设置 → 扩展 停用，或直接删除用户插件根下的 `com.gitter.html-preview` 目录。

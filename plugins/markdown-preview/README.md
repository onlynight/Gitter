# Markdown 预览（外部 L2 插件样例）

Gitter 首个**外部**代码插件：经 `file.preview` 的 previewProviders 接缝接管 `.md`/`.markdown` 预览，
markdown-it 渲染只读 HTML（`html:false` 禁内联标签，渲染产物进渲染层 `sandbox=""` iframe，脚本不可执行）。

## 消费点

- **文件页**：点击 `.md` → 编辑器画布显示预览；右上 HUD 或回退卡「编辑源文件」切 Monaco 文本，预览按钮切回。
- **任务面板**：任务改动 `.md` → 文件 tab 预览模式显示渲染结果；无插件时回退卡可跳内置编辑器。

## 构建与安装

```bash
node plugins/markdown-preview/build.mjs --install
```

- 打包 `src/main.ts` → 单文件 CJS `main.js`（markdown-it 内联，宿主零新增依赖；esbuild/markdown-it 从 `web/node_modules` 解析）；
- 复制 `manifest.json` + `main.js` → `%APPDATA%/<gitter-app|Gitter>/packages/com.gitter.markdown-preview/`。

## 启用（信任门）

1. 应用内 设置 → 扩展 → 打开 **「允许代码插件」**（`settings.allowCodePlugins`，默认关）；
2. 重启或切换该设置触发 `extensions.changed` → 宿主 `activateAll` 装载 entry → provider 注册；
3. 打开任意 `.md` 验证：预览渲染、`设置 → 扩展` 列表出现「Markdown 预览」（可启停）。

## 卸载

设置 → 扩展 停用，或直接删除用户插件根下的 `com.gitter.markdown-preview` 目录。

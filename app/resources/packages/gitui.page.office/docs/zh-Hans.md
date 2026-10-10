# Office 文档页

项目内 Office 文档的**页内预览**（office-integration-plan.md §10 预览-only）。
编辑一律交给外部应用——顶栏「用外部程序打开」是全部格式的编辑入口。

## 使用

- 左侧列出当前仓库内全部 Office 文件（类型徽标：PPT 橙 / Word 蓝 / Excel·表格族 绿 / PDF 红）。
- 单击文件即在右侧渲染预览（只读）；顶栏显示文件体积与页数。
- 「用外部程序打开」= 用系统默认程序打开原文件（编辑入口）。
- 预览失败（文件损坏 / 不支持的结构）时显示失败原因，可重试或转外部程序打开。

## 预览范围

| 格式 | 渲染 | 说明 |
| --- | --- | --- |
| `.pdf` | pdfjs-dist 6（canvas 逐页，适宽缩放） | worker 经 classic blob 装载（沙箱内 module worker 被 Chromium 拒绝） |
| `.docx` `.docm` `.dotx` | docx-preview 0.4（版式保真 DOM） | 分页/表格/图片/页眉页脚 |
| `.xlsx` `.xlsm` `.xltx` `.ods` | SheetJS 解析 → 自绘 HTML 表 | 工作表 tab、列宽、合并单元格、数字右对齐 |
| `.csv` `.tsv` | SheetJS 文本解析 → 同上表格 | 分隔符自动嗅探；走文本通道（8MB 上限） |
| `.pptx` `.ppsx` `.pptm` `.potx` | pptx-preview 1.0（试做） | 文本框/图片级保真；复杂主题/SmartArt 不完整 |
| `.doc` `.xls` `.ppt` `.odt` `.odp` `.rtf` 等 | 不预览 | 旧格式无成熟纯前端渲染器，直接外部打开 |

## 隔离与边界

- 预览渲染库（pdfjs / docx-preview / SheetJS / pptx-preview）全部内联在
  `sandbox="allow-scripts"` iframe（opaque origin）文档内，与宿主样式/JS 零交集；
  渲染异常被捕获后以「预览失败」兜底卡呈现（office-integration-plan.md §10.5）。
- 二进制格式走 `file.readBinary`（base64，50MB 上限）；csv/tsv 走 `file.content`
  文本通道（8MB 上限）；本页无写权限（manifest 只声明 `git.read` + `window`）。
- 表格渲染有行列护栏（5000 行 × 120 列），超限截断并提示。

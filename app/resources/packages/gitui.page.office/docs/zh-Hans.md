# Office 文档页

项目内 Office 文档的**页内预览**（office-integration-plan.md §10 预览-only）。
编辑一律交给外部应用——顶栏「用外部程序打开」是全部格式的编辑入口。

> 本包当前为骨架版：文件列表 + 外部打开已可用；各格式的页内预览按方案 §10.6
> 分阶段接入（pdf / docx / xlsx·ods / csv·tsv 先行，pptx 试做），预览渲染全部
> 隔离在独立 iframe 文档内，第三方库的样式与异常不波及宿主。

## 使用

- 左侧列出当前仓库内全部 Office 文件（类型徽标：PPT 橙 / Word 蓝 / Excel 绿）。
- 单击文件：顶栏显示文件名，可一键用系统默认程序打开原文件（编辑入口）。
- 页内预览接入后：选中即在右侧渲染，只读，不提供页内修改。

## 范围（§10.2）

- 预览：`.pdf` `.docx` `.pptx`（试做）`.xlsx` `.xlsm` `.ods` `.csv` `.tsv`；
- 列表展示 + 外部打开（无成熟纯前端渲染器）：`.doc` `.xls` `.ppt` `.odt` `.odp` `.rtf` 及 Apple 三件套；
- 图片与纯文本由 Files 页既有通道承载，本页不重复建设。

## 通道

- 只读：`file.readBinary`（OOXML 白名单 base64 通道，读上限 50MB）/ `repo.tree`；
- 本页无写权限（manifest 只声明 `git.read` + `window`）；`file.writeBinary` 桥通道
  保留给 agent 侧使用。

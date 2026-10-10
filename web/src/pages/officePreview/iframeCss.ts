/**
 * iframe 预览文档的内建样式（office-integration-plan.md §10.5）：
 * 只随 srcdoc 进入 iframe 文档，与宿主样式零交集。文档类预览恒为白纸内容，
 * 背板/表头等 chrome 色按 dark 类两档（宿主在 render 消息里带 dark 标志）。
 */
export const IFRAME_CSS = `
html, body { margin: 0; padding: 0; height: 100%; }
body {
  font-family: system-ui, "Segoe UI", "Microsoft YaHei", sans-serif;
  background: #f2f2f2; color: #222;
}
body.dark { background: #1f1f1f; color: #ddd; }
#gitter-preview-root { position: absolute; inset: 0; overflow: auto; overflow-anchor: none; }
/* overflow-anchor:none：pdf 缩放重渲染会整片替换画布，Chromium 滚动锚定在
   DOM 替换时自行调整 scrollTop，与中心锚定的滚动补偿相互打架（实测
   st 800→1182 的补偿被锚定改写成 382）。我们是程序化滚动的确定性场景，禁用。 */
/* 内容层缩放载体：transform: scale（宿主经消息设置）。
   width:max-content 让滚动包围盒恰好等于内容（放大的空边不出现），
   margin:0 auto 在窄于视口时居中、溢出时自动归零（不会左侧不可达）。 */
.gpv-content { width: max-content; min-width: 100%; margin: 0 auto; transform-origin: 0 0; }
.gpv-empty { padding: 48px 24px; text-align: center; font-size: 12.5px; opacity: .6; }

/* pdf：灰背板 + 居中页卡 */
.gpv-pdf { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 24px 0; }
.gpv-pdf-page { background: #fff; box-shadow: 0 2px 12px rgba(0, 0, 0, .28); }

/* docx：docx-preview 自带 .docx-wrapper 灰底，覆写为透明贴合主题背板 */
.gpv-docx .docx-wrapper { background: transparent; padding: 24px 0; }

/* 表格：工作表 tab 条（sticky，位于滚动容器直下、缩放载体之外——横纵双向钉扎）+ 白底表格 */
.gpv-sheet-tabs {
  position: sticky; top: 0; left: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 2px;
  padding: 5px 8px; background: #e8e8e8; border-bottom: 1px solid #d0d0d0;
}
body.dark .gpv-sheet-tabs { background: #262626; border-bottom-color: #3a3a3a; }
.gpv-sheet-tabs button {
  appearance: none; border: 1px solid transparent; border-radius: 4px; padding: 2px 10px;
  font: inherit; font-size: 12px; background: transparent; color: inherit; cursor: pointer;
}
.gpv-sheet-tabs button:hover { background: rgba(127, 127, 127, .15); }
.gpv-sheet-tabs button.active { background: #fff; border-color: #c9c9c9; font-weight: 600; }
body.dark .gpv-sheet-tabs button.active { background: #3a3a3a; border-color: #4a4a4a; }
.gpv-sheet-table { padding: 0 12px 24px; }
.gpv-sheet-table table { border-collapse: collapse; background: #fff; color: #1a1a1a; font-size: 12.5px; table-layout: fixed; }
.gpv-sheet-table td {
  border: 1px solid #ddd; padding: 3px 8px; vertical-align: top;
  overflow: hidden; white-space: pre-wrap; word-break: break-word; max-width: 400px;
}
.gpv-sheet-table td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.gpv-sheet-table td.hint { text-align: center; color: #888; font-size: 11.5px; background: #f6f6f6; }

/* pptx：pptx-preview 自绘幻灯片，仅给外边距 */
.gpv-pptx { padding: 16px 0 24px; }
`;

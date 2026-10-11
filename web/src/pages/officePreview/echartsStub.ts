/**
 * echarts 构建期替身（页面包拆分方案 S5）：officeview 预览运行时构建时经 alias
 * （build-pages.mjs buildOfficePreviewRuntime，^echarts$ → 本模块）顶替真包——
 * echarts 全量（~1MB，sideEffects 声明含 index 与全部 chart/component 注册文件，
 * 命名空间导入即全量入包）不再打进 officeview.js，改由 gitui.lib.chart 库包独立
 * 提供与独立启停。
 *
 * 运行时兑现：iframe srcdoc 先执行 chart 运行时（挂 self.GITTER_CHART）再执行预览
 * 运行时，pptx-preview 渲染图表幻灯片（`init(el, null, { renderer: "svg" })`）时经
 * 本替身惰性委托到真实现；chart 库缺席（required:false 可选依赖）时仅在渲染含图表
 * 幻灯片时抛错——pdf/docx/xlsx 与无图表幻灯片不受影响（renderPptx catch → 文档级
 * 错误卡，office-integration §10.5 错误兜底路径）。
 *
 * 导出面 = pptx-preview dist 实际用到的命名空间成员（一次性分析脚本核对：仅 init）；
 * rollup 对缺失命名导出构建期报错——pptx-preview 升级引入新成员时构建即失败，
 * 在此同步补铺（tsc 走 node_modules 真 echarts 类型，运行时不入包）。
 */
function chartNs(): unknown {
  const c = (self as unknown as { GITTER_CHART?: unknown }).GITTER_CHART;
  if (!c) {
    throw new Error("GITTER_CHART 未装载——pptx 内嵌图表渲染需要 gitui.lib.chart 库（可选依赖缺席，降级为文档级错误卡）");
  }
  return c;
}

export const init = (...args: unknown[]): unknown =>
  (chartNs() as { init: (...a: unknown[]) => unknown }).init(...args);

// use：echarts 按需注册入口——pptx-preview 当前未用（rollup 摇除），铺上防升级即断
export const use = (...args: unknown[]): unknown =>
  (chartNs() as { use: (...a: unknown[]) => unknown }).use(...args);

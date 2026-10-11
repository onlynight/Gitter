/**
 * gitui.lib.chart 库运行时入口（页面包拆分方案 S5）：echarts 全量（含 SVG 渲染器——
 * pptx-preview 图表幻灯片走 `init(el, null, { renderer: "svg" })`）构建为独立 IIFE，
 * build-pages.mjs buildChartLib 把产物包成字符串资产 wrapper（GITTER_LIBS.chart =
 * { version, runtimeJs }）落盘 gitui.lib.chart/chart.js——echarts 代码本体只存在于
 * 字符串中，宿主文档零执行（D4 字符串资产库语义，与 officeview 同构）。
 *
 * 兑现路径：officeview 组装 iframe srcdoc 时把 chart 运行时排在预览运行时之前
 * （officeview.srcdocScripts），本文件在 iframe 文档内 eval 时挂 self.GITTER_CHART，
 * echartsStub（officeview 构建期替身）惰性委托到它。
 */
import * as echarts from "echarts";

(self as unknown as { GITTER_CHART?: unknown }).GITTER_CHART = echarts;

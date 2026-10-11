/**
 * Monaco 库入口（GITTER_LIBS 机制，页面包拆分方案 S3）：
 * monaco-editor 全量（editor.main + basic-languages Monarch + json/css/html/typescript
 * 语言服务）构建为独立 IIFE 经典脚本 → gitui.lib.monaco/monaco.js，eval 时挂
 * window.GITTER_LIBS.monaco——声明依赖的页面包（gitui.page.files）由页装载器
 * 先注入本库再注入页面 entry（import 提升语义，页面代码同步取用）。
 *
 * 从 gitui.page.files 拆出的动机（inline-editor-plan.md §2.2 旧裁决的推翻执行）：
 * Monaco 升级只重建本包（manifest version 与 web/package.json 同步断言在
 * build-pages.mjs buildMonacoLib），files 页产物零重建；其他页面/未来第三方页
 * 可按同一依赖声明复用编辑器能力。
 *
 * Worker：file:// + webSecurity 下 `new Worker(相对 URL)` 被同源策略拦截；
 * `?worker&inline` + `worker: { format: "iife" }`（build-pages.mjs 本库构建）把五个
 * worker 编译为 base64 内联、运行期经 Blob URL 构造，无跨源问题（§8.3 风险裁决）。
 * 必须用 &inline：普通 `?worker` 会附带产出 assets/*.worker-*.js 死重，页装载器不装载。
 *
 * CSS：经 build-pages.mjs monacoCssInline 插件以「自注入 <style>」JS 模块打包进本库，
 * codicon 等字体内联 data URI——monaco.js 即装即用。
 */
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker&inline";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker&inline";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker&inline";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker&inline";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker&inline";

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case "json": return new jsonWorker();
      case "css": return new cssWorker();
      case "html": return new htmlWorker();
      case "typescript":
      case "javascript": return new tsWorker();
      default: return new editorWorker();
    }
  },
};

const w = window as unknown as { GITTER_LIBS?: Record<string, unknown> };
w.GITTER_LIBS = w.GITTER_LIBS ?? {};
w.GITTER_LIBS.monaco = monaco;

export default monaco;

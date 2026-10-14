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
// TokenizationRegistry 模块单例：与 editor.main 的注册面同实例，basic-languages /
// aura / hat 的 Monarch 分词器经它惰性解析（类型面见 monacoInternal.d.ts）
import { TokenizationRegistry, type ITokenizationSupportLike } from "monaco-editor/esm/vs/editor/common/languages.js";
import { auraConf, auraLanguage } from "./monarch/aura";
import { hatConf, hatLanguage } from "./monarch/hat";

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

// 本地 Monarch 语言注册（AuraLang 生态）。与 Monaco 内置 basic-languages 一同打入库包，
// 页面侧经 languageForPath（filesMonaco.ts）以 languageId 取用，无需动态 register。
// 参考：web/src/libs/monarch/aura.ts 与 hat.ts。Token 命名遵循 Monaco 惯例，
// 主题 tokenColors 由 filesMonaco.ts buildTheme 统一映射（EditorTheme.syntax）。
monaco.languages.register({ id: "aura", extensions: [".aura"], aliases: ["Aura", "aura"] });
monaco.languages.setMonarchTokensProvider("aura", auraLanguage);
monaco.languages.setLanguageConfiguration("aura", auraConf);

monaco.languages.register({ id: "hat", extensions: [".hat"], aliases: ["HAT", "hat"] });
monaco.languages.setMonarchTokensProvider("hat", hatLanguage);
monaco.languages.setLanguageConfiguration("hat", hatConf);

const w = window as unknown as { GITTER_LIBS?: Record<string, unknown> };
w.GITTER_LIBS = w.GITTER_LIBS ?? {};
w.GITTER_LIBS.monaco = monaco;

// ---------- Monarch 语法分词面（monacoSyntax，供 DiffView 等 HTML 渲染场景离线分词） ----------
//
// 与编辑器完全同源：同一 TokenizationRegistry 单例、同一 Monarch 词法器，跨行状态
// （模板串/块注释）经 endState 逐行传递。返回字符串 token type（如 "type.identifier"），
// 颜色由调用方按主题 syntax 表前缀匹配（kit/syntaxMonarch.ts）——分词与取色解耦，
// 切主题无需重分词。非 Monarch 实现（未来 TextMate/tree-sitter 支持）没有字符串面，
// 返回空结果调用方自然纯文本降级。plaintext/未知语言 getOrCreate 返回 null，同样降级。

/** Monarch 行分词单行产出（行内偏移 [start,end)；type = monarch token type 字符串）。 */
export interface MonarchTokenRun {
  start: number;
  end: number;
  type: string;
}

/** 每 512 行让出主线程一次——大 diff 分词不长时间阻塞 UI（Monarch 同步逐行跑）。 */
const TOKENIZE_YIELD_MASK = 511;

async function tokenizeLines(text: string, languageId: string): Promise<MonarchTokenRun[][]> {
  const support = await TokenizationRegistry.getOrCreate(languageId);
  if (!support || typeof support.tokenize !== "function") return [];
  const tokenize = support.tokenize.bind(support);
  let state = support.getInitialState();
  const lines = text.split("\n");
  const out: MonarchTokenRun[][] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const runs: MonarchTokenRun[] = [];
    try {
      const r = tokenize(line, true, state);
      if (r) {
        state = r.endState;
        const toks = r.tokens;
        for (let j = 0; j < toks.length; j++) {
          const start = toks[j].offset;
          const end = j + 1 < toks.length ? toks[j + 1].offset : line.length;
          if (end <= start) continue;
          runs.push({ start, end, type: toks[j].type });
        }
      }
    } catch {
      state = support.getInitialState(); // 单行异常：状态重置继续，该行降级纯文本
    }
    out.push(runs);
    if ((i & TOKENIZE_YIELD_MASK) === TOKENIZE_YIELD_MASK) {
      await new Promise<void>((r) => setTimeout(r));
    }
  }
  return out;
}

w.GITTER_LIBS.monacoSyntax = { tokenizeLines };

export type { ITokenizationSupportLike };
export default monaco;

/**
 * 页面侧 LSP 客户端（inline-editor-plan.md §4.5，P3）：
 * 把 Monaco model 生命周期桥接到宿主 lsp.* RPC——didOpen / didChange(全量同步, 防抖) / didClose，
 * 注册补全/hover provider，消费 textDocument/publishDiagnostics → setModelMarkers。
 *
 * 覆盖面：TS/JS/JSON/CSS/HTML 的智能提示由 Monaco 内置语言服务提供（filesMonaco 全量入口），
 * 本模块只服务设置里显式启用的外部服务器——typescript（ts/js）与 python（pyright），
 * 关闭设置时零 RPC、零 provider 开销（guard 直返）。
 *
 * 全量同步（TextDocumentSyncKind.Full）：不用增量 diff，实现最薄且所有服务器都支持；
 * didChange 经 400ms 防抖合并，键入不至于每击一次全文 IPC。
 */
import * as monaco from "monaco-editor";
import { pageSdk } from "../pageSdk";

/** monaco 语言 id → LSP 服务器键（lsp.start 的 language 参数）。 */
function serverKeyOf(languageId: string): string | null {
  if (languageId === "typescript" || languageId === "javascript") return "typescript";
  if (languageId === "python") return "python";
  return null;
}

/** settings 字段名（P3：两台服务器，开关 + 命令覆盖）。 */
const SETTINGS_OF_SERVER: Record<string, { enabled: string; command: string; fallback: string }> = {
  typescript: { enabled: "lspTypescript", command: "lspTypescriptCommand", fallback: "typescript-language-server --stdio" },
  python: { enabled: "lspPython", command: "lspPythonCommand", fallback: "pyright-langserver --stdio" },
};

/** path → LSP file URI（windows 盘符大写；服务器回显按原样匹配，读侧做归一）。 */
function pathToUri(path: string): string {
  const norm = path.replace(/\\/g, "/").replace(/^\/+/, "");
  return `file:///${norm}`;
}

/** 服务器 URI → 本地 path（容驱动器大小写与百分号编码差异）。 */
function uriToPath(uri: string): string {
  try {
    let p = decodeURIComponent(uri.replace(/^file:\/\//i, "")).replace(/\\/g, "/");
    p = p.replace(/^([A-Za-z]):/, (_m, d: string) => d.toUpperCase() + ":");
    return p;
  } catch {
    return uri;
  }
}

/** LSP Diagnostic.severity → Monaco MarkerSeverity。 */
function markerSeverity(sev: number | undefined): number {
  // 1 Error / 2 Warning / 3 Info / 4 Hint（monaco.MarkerSeverity 同值序）
  return Math.min(Math.max(sev ?? 2, 1), 4) as number;
}

interface OpenDoc {
  path: string;
  languageId: string;
  version: number;
  model: monaco.editor.ITextModel;
  changeTimer: number | null;
  pendingText: string | null;
}

const docs = new Map<string, OpenDoc>(); // path → doc
/** 服务器启动态：ok=在跑 failed=本会话不再重试（避免每次键入都撞启动失败） */
const startState = new Map<string, "ok" | "failed">();
const startPromises = new Map<string, Promise<boolean>>();
let providersRegistered = false;
let eventSubscribed = false;

function ensureEventSubscription(): void {
  if (eventSubscribed) return;
  eventSubscribed = true;
  pageSdk.on("lsp.event" as never, (raw: unknown) => {
    const p = raw as { language: string; method: string; params: never };
    if (!p || p.method !== "textDocument/publishDiagnostics") return;
    const params = p.params as { uri: string; diagnostics: { range: { start: { line: number; character: number }; end: { line: number; character: number } }; severity?: number; message: string; code?: string | number }[] };
    const doc = docs.get(uriToPath(params.uri));
    if (!doc || doc.model.isDisposed()) return;
    const markers = (params.diagnostics ?? []).map((d) => ({
      severity: markerSeverity(d.severity),
      message: d.message,
      source: p.language,
      startLineNumber: d.range.start.line + 1,
      startColumn: d.range.start.character + 1,
      endLineNumber: d.range.end.line + 1,
      endColumn: d.range.end.character + 1,
    }));
    monaco.editor.setModelMarkers(doc.model, "lsp", markers);
  });
}

/** 读设置：该服务器是否启用 + 命令行。 */
function serverConfig(serverKey: string): string | null {
  const cfg = SETTINGS_OF_SERVER[serverKey];
  if (!cfg) return null;
  const s = pageSdk.settings() as Record<string, unknown> | null;
  if (!s || s[cfg.enabled] !== true) return null;
  const command = typeof s[cfg.command] === "string" && (s[cfg.command] as string).trim()
    ? (s[cfg.command] as string).trim()
    : cfg.fallback;
  return command;
}

/** 幂等启动服务器（失败标记 failed，不再重试——重启页面/改设置后重进生效）。 */
function ensureServer(serverKey: string): Promise<boolean> {
  const st = startState.get(serverKey);
  if (st === "ok") return Promise.resolve(true);
  if (st === "failed") return Promise.resolve(false);
  const inflight = startPromises.get(serverKey);
  if (inflight) return inflight;
  const command = serverConfig(serverKey);
  if (!command) return Promise.resolve(false);
  ensureEventSubscription();
  const p = pageSdk
    .call<{ status: string; error?: string }>("lsp.start", { language: serverKey, command })
    .then((info) => {
      const ok = info?.status === "running";
      startState.set(serverKey, ok ? "ok" : "failed");
      startPromises.delete(serverKey);
      return ok;
    })
    .catch(() => {
      startState.set(serverKey, "failed");
      startPromises.delete(serverKey);
      return false;
    });
  startPromises.set(serverKey, p);
  return p;
}

/** 注册补全/hover provider（首次有服务器跑起来时一次；guard 挡住未启用语言的开销）。 */
function ensureProviders(): void {
  if (providersRegistered) return;
  providersRegistered = true;
  const langs = ["typescript", "javascript", "python"];
  monaco.languages.registerCompletionItemProvider(langs, {
    triggerCharacters: [".", "/", '"', "'"],
    provideCompletionItems: async (model, position) => {
      const path = modelPaths.get(model);
      const doc = path ? docs.get(path) : null;
      const serverKey = doc ? serverKeyOf(doc.languageId) : null;
      if (!doc || !serverKey || startState.get(serverKey) !== "ok") return null;
      try {
        const word = model.getWordUntilPosition(position);
        const items = await pageSdk.call<{ items?: { label: string; kind?: number; detail?: string; insertText?: string; sortText?: string }[] }>(
          "lsp.request", {
            language: serverKey,
            method: "textDocument/completion",
            params: {
              textDocument: { uri: pathToUri(doc.path) },
              position: { line: position.lineNumber - 1, character: position.column - 1 },
              context: { triggerKind: 1 },
            },
          });
        const list = Array.isArray(items) ? items : items?.items ?? [];
        return {
          suggestions: list.map((it, i) => ({
            label: String(it.label),
            kind: (it.kind ?? 13) as number,
            detail: it.detail,
            insertText: it.insertText ?? String(it.label),
            sortText: it.sortText ?? `${i}`.padStart(6, "0"),
            range: { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn },
          })),
        };
      } catch {
        return null;
      }
    },
  });
  monaco.languages.registerHoverProvider(langs, {
    provideHover: async (model, position) => {
      const path = modelPaths.get(model);
      const doc = path ? docs.get(path) : null;
      const serverKey = doc ? serverKeyOf(doc.languageId) : null;
      if (!doc || !serverKey || startState.get(serverKey) !== "ok") return null;
      try {
        const hover = await pageSdk.call<{ contents?: { value?: string } | { value?: string }[]; range?: unknown } | null>(
          "lsp.request", {
            language: serverKey,
            method: "textDocument/hover",
            params: {
              textDocument: { uri: pathToUri(doc.path) },
              position: { line: position.lineNumber - 1, character: position.column - 1 },
            },
          });
        if (!hover) return null;
        const contents = Array.isArray(hover.contents) ? hover.contents : [hover.contents ?? { value: "" }];
        const text = contents.map((c) => c?.value ?? "").filter(Boolean).join("\n\n");
        if (!text) return null;
        return { contents: [{ value: text }] };
      } catch {
        return null;
      }
    },
  });
}

/** model → path 反查（provider/诊断回调拿不到 path——model 是唯一可用键）。 */
const modelPaths = new Map<monaco.editor.ITextModel, string>();

// ---- 对 FilesEditorPane 暴露的生命周期钩子 ----

/** 文件打开（loadFile 成功后调用）：注册 model + 启服务器 + didOpen。 */
export function documentOpened(path: string, languageId: string, text: string, model: monaco.editor.ITextModel): void {
  const serverKey = serverKeyOf(languageId);
  if (!serverKey) return;
  if (docs.has(path)) return;
  modelPaths.set(model, path);
  docs.set(path, { path, languageId, version: 1, model, changeTimer: null, pendingText: null });
  void ensureServer(serverKey).then((ok) => {
    if (!ok) return;
    ensureProviders();
    pageSdk.call("lsp.notify", {
      language: serverKey,
      method: "textDocument/didOpen",
      params: { textDocument: { uri: pathToUri(path), languageId, version: 1, text } },
    }).catch(() => { /* 服务器侧失败：诊断自然不来，编辑不受影响 */ });
  });
}

/** 内容变化（handleContentChange 调用；400ms 防抖合并全量同步）。 */
export function documentChanged(path: string, text: string): void {
  const doc = docs.get(path);
  const serverKey = doc ? serverKeyOf(doc.languageId) : null;
  if (!doc || !serverKey || startState.get(serverKey) !== "ok") return;
  doc.pendingText = text;
  if (doc.changeTimer !== null) window.clearTimeout(doc.changeTimer);
  doc.changeTimer = window.setTimeout(() => {
    doc.changeTimer = null;
    const t = doc.pendingText;
    doc.pendingText = null;
    if (t === null || doc.model.isDisposed()) return;
    doc.version += 1;
    pageSdk.call("lsp.notify", {
      language: serverKey,
      method: "textDocument/didChange",
      params: { textDocument: { uri: pathToUri(path), version: doc.version }, contentChanges: [{ text: t }] },
    }).catch(() => { /* 忽略 */ });
  }, 400);
}

/** 标签关闭（closeTabImpl 调用）：didClose + 清理映射与诊断。 */
export function documentClosed(path: string): void {
  const doc = docs.get(path);
  if (!doc) return;
  if (doc.changeTimer !== null) window.clearTimeout(doc.changeTimer);
  if (!doc.model.isDisposed()) monaco.editor.setModelMarkers(doc.model, "lsp", []);
  modelPaths.delete(doc.model);
  docs.delete(path);
  const serverKey = serverKeyOf(doc.languageId);
  if (serverKey && startState.get(serverKey) === "ok") {
    pageSdk.call("lsp.notify", {
      language: serverKey,
      method: "textDocument/didClose",
      params: { textDocument: { uri: pathToUri(path) } },
    }).catch(() => { /* 忽略 */ });
  }
}

/**
 * 文件编辑器会话持久化（仓库域）：记住上次打开的标签顺序/激活位与每个文件的光标位置。
 *
 * 存储用 localStorage——仓库内相对路径 + 行/列本身即仓库域，多窗口共享一份正是期望
 * 语义（新窗口打开同一仓库 → 接着上次的标签与位置）；键按仓库绝对路径隔离，避免
 * 与 ProjectsPage 等「跨仓库全局 UI 态」键混淆。
 *
 * 位置存为「行/列 + 锚点文本」：文件被改动后原行号可能错位，恢复时先按锚点文本就近
 * 搜索定位（命中则精确落位），未命中才回退行号——比裸行号抗改动。
 */
import type MonacoNs from "monaco-editor";

type MonacoEditorViewState = MonacoNs.editor.ICodeEditorViewState;

const KEY_PREFIX = "gitter.files.session.v1";

export interface EditorSessionTab {
  path: string;
  pinned: boolean;
}

/** 文件查看模式（仅对有画布查看器的文件有效——md/html 等）：
 *  edit = Monaco 文本；preview = 外部预览画布（iframe/pre）。
 *  普通代码文件（无 viewer）恒为 edit，不入本表。 */
export type EditorMode = "edit" | "preview";

export interface EditorSession {
  tabs: EditorSessionTab[];
  /** 激活标签的仓库相对路径 */
  active: string | null;
  /** 各文件视图状态（按 Monaco 规范化 URI 键）：monaco = 精确视图态；anchor = 抗改动兜底；
   *  previewScroll = 预览态（md/html iframe / pre）上次滚动位置，重开时恢复 */
  views: Record<string, { monaco?: MonacoEditorViewState; anchor?: { line: number; col: number; text: string }; previewScroll?: number }>;
  /** 各文件查看模式（按仓库相对路径键）；仅记录 md/html 等有查看器的文件，
   *  缺省 = preview（查看器接管默认态） */
  modes: Record<string, EditorMode>;
}

interface StoredShape {
  tabs: { path: string; pinned: boolean }[];
  active: string | null;
  views: Record<string, { monaco?: unknown; anchor?: { line: number; col: number; text: string } | null; previewScroll?: unknown }>;
  modes: Record<string, string>;
}

const TAB_LIMIT = 64;
const VIEW_LIMIT = 200;

function keyFor(repo: string): string {
  return KEY_PREFIX + "|" + repo.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** 读取会话（缺档/损坏 → 空会话，不抛错；损坏的 JSON 覆盖为新档，避免反复解析失败）。 */
export function loadSession(repo: string): EditorSession {
  const empty: EditorSession = { tabs: [], active: null, views: {}, modes: {} };
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(keyFor(repo));
  } catch {
    return empty;
  }
  if (!raw) return empty;
  try {
    const d = JSON.parse(raw) as Partial<StoredShape>;
    const tabs = Array.isArray(d.tabs)
      ? d.tabs.filter((x): x is EditorSessionTab => !!x && typeof (x as { path?: unknown }).path === "string")
            .slice(0, TAB_LIMIT)
            .map((x) => ({ path: x.path, pinned: x.pinned === true }))
      : [];
    const views: EditorSession["views"] = {};
    if (d.views && typeof d.views === "object") {
      for (const [k, v] of Object.entries(d.views)) {
        if (!v || typeof v !== "object") continue;
        const anchor = v.anchor;
        const vs: EditorSession["views"][string] = {};
        if (v.monaco && typeof v.monaco === "object") vs.monaco = v.monaco as MonacoEditorViewState;
        if (anchor && typeof anchor.line === "number" && typeof anchor.col === "number") {
          vs.anchor = { line: anchor.line, col: anchor.col, text: typeof anchor.text === "string" ? anchor.text : "" };
        }
        if (typeof v.previewScroll === "number" && Number.isFinite(v.previewScroll)) vs.previewScroll = v.previewScroll;
        if (vs.monaco || vs.anchor || vs.previewScroll !== undefined) views[k] = vs;
      }
    }
    const modes: EditorSession["modes"] = {};
    if (d.modes && typeof d.modes === "object") {
      for (const [k, v] of Object.entries(d.modes)) {
        if (v === "edit" || v === "preview") modes[k] = v;
      }
    }
    const active = typeof d.active === "string" && d.active ? d.active : null;
    return { tabs, active: active ?? tabs[0]?.path ?? null, views, modes };
  } catch {
    try {
      window.localStorage.setItem(keyFor(repo), JSON.stringify(empty));
    } catch {
      // 存储已满/禁用：静默降级为不持久化
    }
    return empty;
  }
}

/** 写入会话（写入失败静默——只读文件系统/配额满时不影响编辑本身）。 */
export function saveSession(repo: string, s: EditorSession): void {
  const tabs = s.tabs.slice(0, TAB_LIMIT);
  const views: StoredShape["views"] = {};
  let n = 0;
  for (const [k, v] of Object.entries(s.views)) {
    if (n >= VIEW_LIMIT) break;
    if (v.monaco || v.anchor || v.previewScroll !== undefined) {
      const out: { monaco?: unknown; anchor?: { line: number; col: number; text: string } | null; previewScroll?: number } = {};
      if (v.monaco) out.monaco = v.monaco;
      if (v.anchor) out.anchor = v.anchor;
      if (v.previewScroll !== undefined) out.previewScroll = v.previewScroll;
      views[k] = out;
      n++;
    }
  }
  const modes: StoredShape["modes"] = {};
  for (const [k, v] of Object.entries(s.modes ?? {})) {
    if (v === "edit" || v === "preview") modes[k] = v;
  }
  const out: StoredShape = {
    tabs,
    active: s.active && tabs.some((t) => t.path === s.active) ? s.active : null,
    views,
    modes,
  };
  try {
    window.localStorage.setItem(keyFor(repo), JSON.stringify(out));
  } catch {
    // 超配额时降级：丢视图态只留标签，保证下次至少标签恢复
    try {
      window.localStorage.setItem(keyFor(repo), JSON.stringify({ ...out, views: {} }));
    } catch {
      // 仍失败则放弃本次持久化
    }
  }
}

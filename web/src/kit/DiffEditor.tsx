/**
 * Monaco DiffEditor 渲染（diff-view-monaco 裁决）：
 * 语法高亮与文件页编辑器完全同源（同一 monaco 实例 + 同一主题，含 TS 语义 token——
 * 变量/函数着色是 monarch/TextMate 句法分词给不出的），并内建字级 diff、
 * 未变更区域折叠（hideUnchangedRegions）、并排/内联切换（renderSideBySide）。
 * 此处推翻 kit/index.ts「DiffView 不开放替换」旧红线（用户裁决 2026-10）：
 * DiffView 保留未删，消费方按数据形态择一——全量双文本 → 本组件；
 * hunk DTO（二进制/超长回退）→ DiffView。
 *
 * hunk 勾选暂存：modified 侧 glyph margin 出勾选框，点击把该行变更 intersect 到的
 * `git diff` hunk（full.hunks，顺序与服务端 stageHunks 的索引一致）逐个上抛；
 * per-hunk「暂存此块」按钮暂缺——工具栏「暂存所选 N 块」覆盖（后续可用 view zone 补）。
 */
import { memo, useEffect, useRef } from "react";
import { t, useApp } from "../state/store";
import { languageForPath } from "../libs/langId";
import type { DiffFullDTO } from "../bridge/types";

type Monaco = typeof import("monaco-editor");
type DiffEditor = import("monaco-editor").editor.IStandaloneDiffEditor;

function monacoLib(): Monaco | null {
  const w = window as unknown as { GITTER_LIBS?: Record<string, unknown> };
  return (w.GITTER_LIBS?.monaco as Monaco | undefined) ?? null;
}

/** 主题：syntax 键规则与 filesMonaco.buildTheme 同源；diff 行底色按宿主 CSS 配方
 * 现场混色（主题包无 diff 表——green/red 以 alpha 叠在编辑器底色上）。 */
function applyDiffTheme(monaco: Monaco, theme: { base?: string; syntax?: Record<string, string>; tokens?: Record<string, string> } | null) {
  const dark = (theme?.base ?? "dark") !== "light";
  const name = dark ? "gitter-diff-dark" : "gitter-diff-light";
  const tokens = theme?.tokens ?? {};
  const green = tokens.Green ?? (dark ? "#3FB950" : "#1A7F37");
  const red = tokens.Red ?? (dark ? "#F0655A" : "#CF222E");
  monaco.editor.defineTheme(name, {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules: Object.entries(theme?.syntax ?? {}).map(([token, foreground]) => ({ token, foreground })),
    colors: {
      "editor.background": tokens.Base ?? (dark ? "#1e1e1e" : "#ffffff"),
      "editor.foreground": tokens.Text ?? (dark ? "#EAEAEA" : "#1B1B1B"),
      "editorLineNumber.foreground": tokens.Text3 ?? (dark ? "#6E6E6E" : "#8F8F8F"),
      "editor.lineHighlightBackground": dark ? "#ffffff0a" : "#0000000a",
      "editor.selectionBackground": tokens.Link ? tokens.Link + "4D" : dark ? "#264f7880" : "#cfe1f580",
      "diffEditor.insertedTextBackground": green + "29",
      "diffEditor.removedTextBackground": red + "29",
      "diffEditor.insertedLineBackground": green + "1A",
      "diffEditor.removedLineBackground": red + "1A",
      "diffEditor.border": tokens.Border ?? (dark ? "#88888844" : "#dddddd"),
      "diffEditor.unchangedRegionBackground": tokens.Panel ?? (dark ? "#ffffff08" : "#f7f7f8"),
    },
  });
  monaco.editor.setTheme(name);
}

/** 行区间归一（git hunk 与 monaco change 都存在纯插入的空区间：end = start - 1），
 * 收敛为闭区间做相交判断。 */
function normRange(start: number, end: number): [number, number] {
  return [start, Math.max(start, end)];
}

function intersects(a: [number, number], b: [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

export const MonacoDiffView = memo(function MonacoDiffView(props: {
  full: DiffFullDTO;
  /** 内联/并排；缺省跟随全局设置（与 DiffView 同语义） */
  inline?: boolean;
  /** 定位到新增行号：滚动到该行并短暂高亮；line+ts 变化即重复触发 */
  focusLine?: { line: number; ts: number } | null;
  /** 勾选的 git hunk 索引（full.hunks 下标；服务端 stageHunks 同序） */
  selectedHunks?: Set<number>;
  onToggleHunk?: (index: number) => void;
}) {
  const app = useApp();
  const inline = props.inline ?? (app.settings?.diffMode === "inline");
  const monaco = monacoLib();

  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<DiffEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const modelsRef = useRef<{ original: import("monaco-editor").editor.ITextModel; modified: import("monaco-editor").editor.ITextModel } | null>(null);
  const glyphsRef = useRef<import("monaco-editor").editor.IEditorDecorationsCollection | null>(null);
  const focusDecoRef = useRef<import("monaco-editor").editor.IEditorDecorationsCollection | null>(null);
  /** monaco 行变更 → 相交的 git hunk 索引（glyph 点击上抛用） */
  const mapRef = useRef<{ startLine: number; endLine: number; hunkIndices: number[] }[]>([]);
  const hunksRef = useRef(props.full.hunks);
  hunksRef.current = props.full.hunks;
  const toggleRef = useRef(props.onToggleHunk);
  toggleRef.current = props.onToggleHunk;
  const selRef = useRef(props.selectedHunks);
  selRef.current = props.selectedHunks;

  const syncHunkGlyphs = () => {
    const ed = editorRef.current;
    const mc = monacoRef.current;
    if (!ed || !mc) return;
    // 勾选暂存仅在有回调的宿主启用（log 页等只读场景不出 glyph，避免误导点击）
    if (!toggleRef.current) {
      mapRef.current = [];
      glyphsRef.current?.set([]);
      return;
    }
    const changes = ed.getLineChanges() ?? [];
    const map: { startLine: number; endLine: number; hunkIndices: number[] }[] = [];
    for (const c of changes) {
      const orig = normRange(c.originalStartLineNumber, c.originalEndLineNumber);
      const idx: number[] = [];
      hunksRef.current.forEach((h, i) => {
        if (intersects(orig, normRange(h.oldStart, h.oldStart + h.oldCount - 1))) idx.push(i);
      });
      if (idx.length === 0) continue;
      map.push({
        startLine: c.modifiedStartLineNumber,
        endLine: Math.max(c.modifiedStartLineNumber, c.modifiedEndLineNumber),
        hunkIndices: idx,
      });
    }
    mapRef.current = map;
    const sel = selRef.current;
    glyphsRef.current?.set(
      map.map((g) => ({
        range: new mc.Range(g.startLine, 1, g.startLine, 1),
        options: {
          glyphMarginClassName: g.hunkIndices.every((i) => sel?.has(i)) ? "mdiff-glyph sel" : "mdiff-glyph",
          stickiness: mc.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      })),
    );
  };

  // 编辑器装配（一次）：GITTER_LIBS.monaco 由页 loader 按 manifest 依赖注入，实例为
  // window 级单例——模型交换复用同一编辑器（每文件新建 diff editor 的内存/CPU 不可接受）
  useEffect(() => {
    if (!monaco || !hostRef.current) return;
    monacoRef.current = monaco;
    applyDiffTheme(monaco, app.theme);
    const ed = monaco.editor.createDiffEditor(hostRef.current, {
      readOnly: true,
      renderSideBySide: !(app.settings?.diffMode === "inline"),
      hideUnchangedRegions: { enabled: true, minimumLineCount: 6, contextLineCount: 3, revealLineCount: 20 },
      renderIndicators: true,
      ignoreTrimWhitespace: false,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      fontSize: 12,
      lineHeight: 18,
      fontFamily: "'Cascadia Code', 'Fira Code', 'Cascadia Mono', Consolas, monospace",
      glyphMargin: true,
      minimap: { enabled: false },
      stickyScroll: { enabled: false },
      renderOverviewRuler: true,
      originalEditable: false,
    });
    editorRef.current = ed;
    glyphsRef.current = ed.getModifiedEditor().createDecorationsCollection();
    focusDecoRef.current = ed.getModifiedEditor().createDecorationsCollection();
    // glyph margin 点击 → 上抛相交 hunk 的勾选切换
    const mouse = ed.getModifiedEditor().onMouseDown((e) => {
      if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
      const line = e.target.position?.lineNumber;
      if (line == null) return;
      const glyph = mapRef.current.find((g) => line >= g.startLine && line <= g.endLine);
      if (!glyph) return;
      for (const hi of glyph.hunkIndices) toggleRef.current?.(hi);
    });
    const updated = ed.onDidUpdateDiff(() => syncHunkGlyphs());
    return () => {
      mouse.dispose();
      updated.dispose();
      modelsRef.current?.original.dispose();
      modelsRef.current?.modified.dispose();
      modelsRef.current = null;
      ed.dispose();
      editorRef.current = null;
      monacoRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monaco]);

  // 模型交换（full 变化 = 换文件/换内容）
  useEffect(() => {
    const ed = editorRef.current;
    const mc = monacoRef.current;
    if (!ed || !mc) return;
    modelsRef.current?.original.dispose();
    modelsRef.current?.modified.dispose();
    const lang = languageForPath(props.full.path);
    const enc = encodeURIComponent(props.full.path);
    const original = mc.editor.createModel(props.full.original, lang, mc.Uri.parse(`inmemory://diff/${enc}/o`));
    const modified = mc.editor.createModel(props.full.modified, lang, mc.Uri.parse(`inmemory://diff/${enc}/m`));
    ed.setModel({ original, modified });
    modelsRef.current = { original, modified };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monaco, props.full]);

  useEffect(() => {
    editorRef.current?.updateOptions({ renderSideBySide: !inline });
  }, [inline]);

  // 主题（宿主主题变化时重定义 + 应用；挂载期在装配处已应用一次）
  useEffect(() => {
    if (monacoRef.current) applyDiffTheme(monacoRef.current, app.theme);
  }, [monaco, app.theme]);

  useEffect(() => {
    if (monacoRef.current) syncHunkGlyphs();
  }, [monaco, props.full, props.selectedHunks]);

  // focusLine：折叠区可能挡住目标行——revealLineInCenter 自动展开沿途折叠，再短暂高亮
  useEffect(() => {
    const line = props.focusLine?.line;
    const ed = editorRef.current;
    if (!line || !ed) return;
    const mc = monacoRef.current!;
    ed.revealLineInCenter(line);
    focusDecoRef.current?.set([
      { range: new mc.Range(line, 1, line, 1), options: { isWholeLine: true, className: "mdiff-focus-line" } },
    ]);
    const timer = window.setTimeout(() => focusDecoRef.current?.clear(), 1800);
    return () => window.clearTimeout(timer);
  }, [props.focusLine]);

  if (props.full.isBinary || props.full.tooLarge) {
    return <div className="empty-state">{t("Diff_BinaryFile")}</div>;
  }

  return <div ref={hostRef} className="mdiff" />;
});

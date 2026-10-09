/**
 * 编辑器面板（files-editor-redesign-mockup.html §二/§三）：
 * 家内 chip 标签条（预览斜体/脏点与关闭钮互斥/状态着色）+ 面包屑 + Monaco + 页脚状态条。
 * 标签 keep-alive：每个文件一个 ITextModel，切标签只换 model 不销毁编辑器
 * （大文件不重复 tokenize，视图状态随 model.id 存取），关闭标签才 dispose model。
 *
 * 保存：Ctrl+S 显式保存 + 300ms 防抖自动保存。保存前 mtime 冲突检测——
 * 磁盘 mtime 与编辑器记录不一致时弹冲突对话框（重新加载/取消/覆盖）。
 * 关闭含未保存更改的标签弹三选一确认（保存/不保存/取消）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useContextMenu } from "../kit";
import { pageSdk, useAppState } from "../pageSdk";
import { CheckIcon, ChevronSepIcon, CloseIcon, FileIcon, FolderIcon, SearchIcon } from "./filesIcons";
import { FilesMonacoEditor } from "./FilesMonacoEditor";
import { createTextModel, disposeTextModel, languageForPath, languageLabel } from "./filesMonaco";
import { documentOpened, documentChanged, documentClosed } from "./filesLsp";

type MonacoModel = import("monaco-editor").editor.ITextModel;

export interface EditorTab {
  path: string;
  /** 预览标签（斜体，唯一；激活/编辑/双击后转正） */
  preview: boolean;
}

interface EditorState {
  path: string;
  content: string;
  originalContent: string;
  eol: "crlf" | "lf";
  mtime: number;
  dirty: boolean;
  loading: boolean;
  binary: boolean;
  error: string | null;
  truncated: boolean;
}

const STATUS_CLS: Record<string, string> = { M: "gs-M", A: "gs-A", D: "gs-D", R: "gs-R", U: "gs-U", "?": "gs-Q" };
const STATUS_LETTER: Record<string, string> = { M: "M", A: "A", D: "D", R: "R", U: "U", "?": "?" };

export function EditorPane(props: {
  tabs: EditorTab[];
  activeTab: string | null;
  /** path → git 状态码（标签名着色 + 页脚徽标） */
  statusByPath: Record<string, string | null>;
  onActivateTab: (path: string) => void;
  onPinTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onQuickOpen: () => void;
  onToggleSidebar: () => void;
  /** 面包屑点击 → 请求树中揭示当前文件（FilesPage 递增 revealTick） */
  onReveal?: () => void;
  /** 保存成功 → FilesPage 重拉 repo.tree（树状态色 + 页脚 git 字母实时化） */
  onSaved?: () => void;
}) {
  const [editors, setEditors] = useState<Map<string, EditorState>>(new Map());
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [position, setPosition] = useState({ line: 1, col: 1 });
  const [markers, setMarkers] = useState({ errors: 0, warnings: 0 });
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const { showMenu, menuElement } = useContextMenu();
  const saveTimers = useRef<Map<string, number>>(new Map());
  const savedTimer = useRef<number | null>(null);
  // model 缓存：path → ITextModel。独立于 React state（model 不是 React 可渲染对象）
  const models = useRef(new Map<string, MonacoModel>());
  const t = pageSdk.t;

  // 设置项：自动保存开关（设置页「编辑器」区；关闭后仅 Ctrl+S 显式保存）
  const autoSave = useAppState().settings?.editorAutoSave !== false;
  const autoSaveRef = useRef(autoSave);
  autoSaveRef.current = autoSave;

  // 最后一个就绪的 model：新文件加载期间保留其画面，避免 Monaco 卸载重挂造成的闪烁
  const lastReady = useRef<{ path: string; model: MonacoModel } | null>(null);
  const statusOf = useCallback(
    (path: string | null) => (path ? props.statusByPath[path] ?? null : null),
    [props.statusByPath],
  );
  const activeStatus = statusOf(props.activeTab);

  // 活动标签底色 = Monaco 实际渲染的编辑区底色（主题原始 Base token）。
  // 不能用 var(--c-base)：模糊材质下宿主会在 body 级把它覆写成半透明档，
  // 而 Monaco 走的是原始 token——用 CSS 变量会出现「标签与编辑区不同色」。
  const theme = useAppState().theme;
  const editorBg = theme?.tokens?.Base ?? "var(--c-base)";

  // 加载文件内容
  const loadFile = useCallback(async (path: string) => {
    if (models.current.has(path)) return; // 已加载（keep-alive）

    setEditors((prev) => {
      const next = new Map(prev);
      next.set(path, {
        path, content: "", originalContent: "", eol: "lf", mtime: 0,
        dirty: false, loading: true, binary: false, error: null, truncated: false,
      });
      return next;
    });

    try {
      const r = await pageSdk.call<{
        content: string; eol: "crlf" | "lf"; size: number; mtime: number;
        binary: boolean; truncated: boolean;
      } | null>("file.content", { path });

      if (!r) {
        setEditors((prev) => {
          const next = new Map(prev);
          const ed = next.get(path);
          if (ed) { ed.loading = false; ed.error = t("Files_Missing"); }
          return next;
        });
        return;
      }
      if (r.binary) {
        setEditors((prev) => {
          const next = new Map(prev);
          const ed = next.get(path);
          if (ed) { ed.loading = false; ed.binary = true; ed.content = ""; ed.originalContent = ""; }
          return next;
        });
        return;
      }

      // 创建 Monaco model（keep-alive；切标签换 model，不重建编辑器）
      const model = createTextModel(path, r.content);
      models.current.set(path, model);
      // LSP（设置启用时）：注册文档 + 启动对应语言服务器 + didOpen
      documentOpened(path, languageForPath(path), r.content, model);

      setEditors((prev) => {
        const next = new Map(prev);
        const ed = next.get(path);
        if (ed) {
          ed.loading = false;
          ed.content = r.content;
          ed.originalContent = r.content;
          ed.eol = r.eol;
          ed.mtime = r.mtime;
          ed.dirty = false;
          ed.truncated = r.truncated;
          ed.error = r.truncated ? t("Editor_ErrorTruncated") : null;
        }
        return next;
      });
    } catch (e) {
      setEditors((prev) => {
        const next = new Map(prev);
        const ed = next.get(path);
        if (ed) { ed.loading = false; ed.error = (e as Error).message; }
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  // 保存文件（带 mtime 冲突检测）
  const doSave = useCallback(async (path: string, overwrite = false) => {
    const editor = editors.get(path);
    const model = models.current.get(path);
    if (!editor || !model) return;

    // 取最新值（model 是编辑真实态）
    const content = model.getValue();
    if (!editor.dirty && content === editor.originalContent) return;
    if (editor.binary) return;

    // 冲突检测：重新读一次 mtime 与已知 mtime 比对
    let remoteMtime = editor.mtime;
    try {
      const fresh = await pageSdk.call<{ mtime: number; binary: boolean } | null>("file.content", { path });
      if (fresh) remoteMtime = fresh.mtime;
    } catch { /* 检测失败不阻塞保存 */ }

    if (!overwrite && editor.mtime > 0 && remoteMtime !== editor.mtime) {
      setConflict(path);
      return;
    }

    setSaving(true);
    try {
      const r = await pageSdk.call<{ ok: boolean; size: number; mtime: number; error?: string }>(
        "file.write", { path, content, eol: editor.eol });
      if (!r.ok) throw new Error(r.error || t("Editor_SaveFailed"));

      setEditors((prev) => {
        const next = new Map(prev);
        const ed = next.get(path);
        if (ed) {
          ed.dirty = false;
          ed.mtime = r.mtime;
          ed.originalContent = content;
          ed.content = content;
        }
        return next;
      });
      const now = new Date();
      setSavedAt(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
      if (savedTimer.current) window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSavedAt(null), 1600);
      props.onSaved?.(); // git 状态可能变化：刷新树（状态色/页脚字母）
    } catch (e) {
      pageSdk.toast(t("Editor_SaveFailed"), (e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [editors, t]);

  // 自动保存（300ms 防抖；设置关闭时跳过——仅 Ctrl+S 显式保存）
  const scheduleAutoSave = useCallback((path: string) => {
    if (!autoSaveRef.current) return;
    const timer = saveTimers.current.get(path);
    if (timer) window.clearTimeout(timer);
    const newTimer = window.setTimeout(() => {
      saveTimers.current.delete(path);
      void doSave(path);
    }, 300);
    saveTimers.current.set(path, newTimer);
  }, [doSave]);

  // 内容变更（Monaco model 回调）：脏标记 + 自动保存 + LSP didChange（filesLsp 内部防抖）
  const handleContentChange = useCallback((path: string, value: string) => {
    setEditors((prev) => {
      const next = new Map(prev);
      const ed = next.get(path);
      if (ed) { ed.content = value; ed.dirty = true; }
      return next;
    });
    scheduleAutoSave(path);
    documentChanged(path, value);
  }, [scheduleAutoSave]);

  // 关闭标签：LSP didClose + dispose model + 清定时器（确认无未保存更改后才走到这）
  const closeTabImpl = useCallback((path: string) => {
    const timer = saveTimers.current.get(path);
    if (timer) { window.clearTimeout(timer); saveTimers.current.delete(path); }
    documentClosed(path);
    disposeTextModel(models.current.get(path) ?? null);
    models.current.delete(path);
    props.onCloseTab(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 关闭请求：含未保存更改 → 三选一确认（保存/不保存/取消）
  const requestClose = useCallback((path: string | null) => {
    if (!path) return;
    if (editors.get(path)?.dirty) { setConfirmClose(path); return; }
    closeTabImpl(path);
  }, [editors, closeTabImpl]);

  // 记录最后一个就绪的 model：新文件加载期保留其画面（Monaco 不卸载，防闪黑）；
  // 已关闭标签的 model 被 dispose，不再作为保底
  useEffect(() => {
    if (!props.activeTab) return;
    const m = models.current.get(props.activeTab);
    if (m) lastReady.current = { path: props.activeTab, model: m };
  }, [props.activeTab, editors]);

  // 批量关闭（关闭其他/右侧/全部）：未保存的标签保留并提示，不静默丢改动
  const batchClose = useCallback((targets: string[]) => {
    const dirtyKept = targets.filter((p) => editors.get(p)?.dirty).length;
    for (const p of targets) {
      if (!editors.get(p)?.dirty) closeTabImpl(p);
    }
    if (dirtyKept > 0) pageSdk.toast(t("Editor_TabClose"), t("Editor_KeptDirty", dirtyKept));
  }, [editors, closeTabImpl, t]);

  // 标签右键菜单：关闭 / 关闭其他 / 关闭右侧标签 / 关闭所有
  const tabMenu = useCallback((path: string) => {
    const idx = props.tabs.findIndex((x) => x.path === path);
    return [
      { label: t("Editor_TabClose"), hint: "Ctrl+W", action: () => requestClose(path) },
      { label: t("Editor_TabCloseOthers"), action: () => batchClose(props.tabs.filter((x) => x.path !== path).map((x) => x.path)) },
      { label: t("Editor_TabCloseRight"), action: () => batchClose(props.tabs.slice(idx + 1).map((x) => x.path)) },
      { label: t("Editor_TabCloseAll"), action: () => batchClose(props.tabs.map((x) => x.path)) },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.tabs, requestClose, batchClose, t]);

  // 切换标签时确保 model 已加载
  useEffect(() => {
    if (props.activeTab) void loadFile(props.activeTab);
  }, [props.activeTab, loadFile]);

  // 键盘快捷键：Ctrl+S 保存；Ctrl+W 关闭（脏标签先确认）；Ctrl+Tab 循环切换
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (props.activeTab) void doSave(props.activeTab);
      } else if ((e.ctrlKey || e.metaKey) && e.key === "w") {
        e.preventDefault();
        requestClose(props.activeTab);
      } else if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        if (props.tabs.length > 1) {
          const idx = props.activeTab ? props.tabs.findIndex((x) => x.path === props.activeTab) : -1;
          props.onActivateTab(props.tabs[(idx + 1) % props.tabs.length].path);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [props.activeTab, props.tabs, props.onActivateTab, doSave, requestClose]);

  // 组件卸载时清理所有 model 与定时器
  useEffect(() => () => {
    for (const m of models.current.values()) m.dispose();
    models.current.clear();
    for (const timer of saveTimers.current.values()) window.clearTimeout(timer);
    if (savedTimer.current) window.clearTimeout(savedTimer.current);
  }, []);

  const nameOf = (path: string) => path.split("/").pop() ?? path;

  // 渲染空状态：欢迎页（动作列表 + 右下角水印，替代 emoji 空态）
  if (props.tabs.length === 0) {
    const repo = pageSdk.repo();
    return (
      <div className="edwelcome">
        <div className="edwm">GITTER</div>
        <div className="list">
          <div className="h">{t("Editor_WelcomeTitle")}</div>
          <div className="wrow" onClick={props.onQuickOpen}>
            <span className="nm2">{t("Editor_WelcomeOpen")}</span>
            <kbd className="kbd">Ctrl</kbd><kbd className="kbd">P</kbd>
          </div>
          <div className="wrow" onClick={() => pageSdk.navigate("changes")}>
            <span className="nm2">{t("Editor_WelcomeChanges")}</span>
            <kbd className="kbd">Ctrl</kbd><kbd className="kbd">Shift</kbd><kbd className="kbd">G</kbd>
          </div>
          {repo && (
            <div className="wrow" onClick={() => void pageSdk.call("shell.openPath", { path: repo.workDir, editor: true })}>
              <span className="nm2">{t("Editor_WelcomeExternal")}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  const activeEditor = props.activeTab ? editors.get(props.activeTab) : null;
  const activeModel = props.activeTab ? (models.current.get(props.activeTab) ?? null) : null;
  const crumbs = props.activeTab ? props.activeTab.split("/") : [];
  const lang = props.activeTab ? languageLabel(languageForPath(props.activeTab)) : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* 标签条（家内 chip：活动 = panel2 + 描边环；× hover/活动显，脏点其余显） */}
      <div className="edtabs" style={{ background: editorBg }}>
        <div className="edtabs-list">
          {props.tabs.map((tab) => {
            const isActive = tab.path === props.activeTab;
            const isDirty = editors.get(tab.path)?.dirty ?? false;
            const st = statusOf(tab.path);
            const nmCls = "nm" + (st ? ` ${STATUS_CLS[st] ?? ""}` : "");
            return (
              <div
                key={tab.path}
                className={"edtab" + (isActive ? " active" : "") + (tab.preview ? " preview" : "")}
                style={isActive ? { background: editorBg, borderBottomColor: editorBg } : undefined}
                title={tab.path}
                onClick={() => props.onActivateTab(tab.path)}
                onDoubleClick={() => props.onPinTab(tab.path)}
                onAuxClick={(e) => { if (e.button === 1) requestClose(tab.path); }}
                onContextMenu={(e) => showMenu(e, tabMenu(tab.path))}
              >
                <span className="fico"><FileIcon path={tab.path} /></span>
                <span className={nmCls}>{nameOf(tab.path)}</span>
                {isDirty && <span className="dot" title={t("Editor_Unsaved")} />}
                <span
                  className="x"
                  title={t("Editor_TabClose")}
                  onClick={(e) => { e.stopPropagation(); requestClose(tab.path); }}
                >
                  <CloseIcon />
                </span>
              </div>
            );
          })}
        </div>
        <div className="edtabs-acts">
          {saving && <span className="saving">{t("Editor_Saving")}</span>}
          <button className="files-ibtn" title={t("Files_QuickOpen")} onClick={props.onQuickOpen}><SearchIcon /></button>
        </div>
      </div>

      {/* 面包屑：路径段（点击 → 树中揭示） */}
      <div className="edcrumbs" style={{ background: editorBg }}>
        {crumbs.map((seg, i) => {
          const p = crumbs.slice(0, i + 1).join("/");
          const last = i === crumbs.length - 1;
          return (
            <span key={p} style={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
              {i > 0 && <span className="csep"><ChevronSepIcon /></span>}
              <span className="cseg" title={p} onClick={() => props.onReveal?.()}>
                <span className="fico">{last ? <FileIcon path={p} /> : <FolderIcon size={13} />}</span>
                <span>{seg}</span>
              </span>
            </span>
          );
        })}
      </div>

      {/* 编辑区：Monaco 实例常驻（新文件加载期保留上一个画面 + Loading 覆盖层，
          不卸载重建——实例重挂是选中文件时「闪黑」的根因） */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative", minHeight: 0 }}>
        {activeEditor && activeEditor.binary ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: 20, textAlign: "center", opacity: 0.7 }}>{t("Editor_ErrorBinary")}</div>
        ) : activeEditor && activeEditor.error && !activeEditor.content ? (
          <div className="ed-note">{activeEditor.error}</div>
        ) : (
          <>
            {(() => {
              // 新文件加载中（尚无 model）：继续显示上一个已就绪的 model（只读），避免卸载闪烁
              const stale = !activeModel && !!(lastReady.current
                && models.current.get(lastReady.current.path) === lastReady.current.model);
              const shown = activeModel ?? (stale ? lastReady.current!.model : null);
              return shown ? (
                <FilesMonacoEditor
                  model={shown}
                  readOnly={stale}
                  onChange={(value) => { if (!stale) handleContentChange(activeEditor!.path, value); }}
                  onPosition={setPosition}
                  onMarkers={setMarkers}
                />
              ) : activeEditor ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", opacity: 0.7 }}>Loading…</div>
              ) : null;
            })()}
            {activeEditor?.loading && <div className="ed-loading">Loading…</div>}
            {activeEditor?.error && !activeEditor.loading && <div className="ed-note">{activeEditor.error}</div>}
          </>
        )}
      </div>

      {/* 页脚状态条：问题 / 光标 / 缩进 / 编码 / EOL / 语言 / git 状态 */}
      <div className="edfoot">
        {savedAt ? (
          <span className="it" title={t("Editor_Saved")}>
            <span className="ok"><CheckIcon /></span> {t("Editor_Saved")} · {savedAt}
          </span>
        ) : (
          <span className="it" title={t("Editor_ProblemsTitle")}>
            <span className="ok"><CheckIcon /></span> {t("Editor_Problems", markers.errors, markers.warnings)}
          </span>
        )}
        <div className="right">
          <span className="it">Ln {position.line}, Col {position.col}</span>
          <span className="it" title={t("Editor_Indent")}>{t("Editor_Spaces", 4)}</span>
          <span className="it">UTF-8</span>
          <span className="it">{(activeEditor?.eol ?? "lf").toUpperCase()}</span>
          <span className="it">{lang}</span>
          {activeStatus && (
            <span className={`it st ${STATUS_CLS[activeStatus] ?? ""}`} title={t("Files_StatusTitle")}>
              {STATUS_LETTER[activeStatus] ?? activeStatus}
            </span>
          )}
        </div>
      </div>

      {/* 关闭含未保存更改的标签：保存 / 不保存 / 取消 */}
      {confirmClose && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmClose(null); }}>
          <div className="modal">
            <h3>{t("Editor_UnsavedTitle")}</h3>
            <div className="modal-body">{t("Editor_UnsavedBody", nameOf(confirmClose))}</div>
            <div className="modal-actions">
              <button className="tool-btn" onClick={() => { const p = confirmClose; setConfirmClose(null); closeTabImpl(p); }}>
                {t("Editor_DontSave")}
              </button>
              <button className="tool-btn" onClick={() => setConfirmClose(null)}>{t("Common_Cancel")}</button>
              <button
                className="tool-btn primary"
                onClick={async () => {
                  const p = confirmClose;
                  setConfirmClose(null);
                  await doSave(p);
                  closeTabImpl(p);
                }}
              >
                {t("Editor_Save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* mtime 冲突：重新加载（放弃本地）/ 取消 / 覆盖（提交本地） */}
      {conflict && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setConflict(null); }}>
          <div className="modal">
            <h3>{t("Editor_ConflictTitle")}</h3>
            <div className="modal-body">{t("Editor_ConflictBody", nameOf(conflict))}</div>
            <div className="modal-actions">
              <button
                className="tool-btn"
                onClick={() => {
                  const p = conflict;
                  setConflict(null);
                  // 重新加载：丢弃本地改动（isFlush 不触发 onChange，LSP 侧手动补一次全量同步）
                  const original = editors.get(p)?.originalContent ?? "";
                  models.current.get(p)?.setValue(original);
                  documentChanged(p, original);
                  setEditors((prev) => {
                    const n = new Map(prev); const ed = n.get(p);
                    if (ed) { ed.content = ed.originalContent; ed.dirty = false; }
                    return n;
                  });
                }}
              >
                {t("Editor_Reload")}
              </button>
              <button className="tool-btn" onClick={() => setConflict(null)}>{t("Common_Cancel")}</button>
              <button
                className="tool-btn primary"
                onClick={() => { const p = conflict; setConflict(null); void doSave(p, true); }}
              >
                {t("Editor_Overwrite")}
              </button>
            </div>
          </div>
        </div>
      )}
      {menuElement}
    </div>
  );
}

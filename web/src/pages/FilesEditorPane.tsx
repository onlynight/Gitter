/**
 * 编辑器面板（files-editor-redesign-mockup.html §二/§三）：
 * 家内 chip 标签条（预览斜体/固定图钉/脏点与关闭钮互斥/状态着色/拖拽排序）+ 面包屑
 * （含转到符号）+ Monaco 主区 + 可选分屏（同 model 双实例）+ 问题面板 + 页脚状态条。
 * 标签 keep-alive：每个文件一个 ITextModel，切标签只换 model 不销毁编辑器
 * （大文件不重复 tokenize，视图状态随 model.id 存取），关闭标签才 dispose model。
 *
 * 保存：Ctrl+S 显式保存 + 300ms 防抖自动保存。保存前 mtime 冲突检测——
 * 磁盘 mtime 与编辑器记录不一致时弹冲突对话框（重新加载/取消/覆盖）。
 * 关闭含未保存更改的标签弹三选一确认（保存/不保存/取消）。
 * 编码：自动嗅探 UTF-8(BOM)/GBK，页脚编码段可重开（脏文件先确认）；保存按原编码+BOM。
 * 状态栏：EOL 点击互转、缩进按内容探测+菜单切换；字号 Ctrl+滚轮/±/0（FilesMonacoEditor）。
 * 外部变更：fsTick 信号 → 批量 stat 打开标签，干净标签自动重载、脏标签提示一次。
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import * as MonacoNs from "monaco-editor";
import { Modal, useContextMenu, DiffView, type CtxMenuItem } from "../kit";
import { pageSdk, useAppState } from "../pageSdk";
import { CheckIcon, ChevronSepIcon, CloseIcon, FileIcon, FolderIcon, OutlineIcon, PinIcon, SearchIcon, SplitIcon } from "./filesIcons";
import { FilesMonacoEditor, type FilesMonacoEditorHandle } from "./FilesMonacoEditor";
import { createTextModel, disposeTextModel, languageForPath, languageLabel, detectIndent, onAnyMarkers, markersOf } from "./filesMonaco";
import { documentOpened, documentChanged, documentClosed } from "./filesLsp";
import { viewerForPath } from "./filesViewers";
import { isExternalPreviewPath } from "./externalPreview";
import type { DiffDTO } from "../bridge/types";

type MonacoModel = import("monaco-editor").editor.ITextModel;

export interface EditorTab {
  path: string;
  /** 预览标签（斜体，唯一；激活/编辑/双击后转正） */
  preview: boolean;
  /** 固定标签（批量关闭跳过；× 换图钉，关闭走右键菜单） */
  pinned?: boolean;
}

type Encoding = "utf8" | "gbk";

interface EditorState {
  path: string;
  content: string;
  originalContent: string;
  eol: "crlf" | "lf";
  /** 文件编码（读取嗅探/重开指定；保存按此编码 + bom 还原） */
  encoding: Encoding;
  bom: boolean;
  mtime: number;
  dirty: boolean;
  loading: boolean;
  binary: boolean;
  error: string | null;
  truncated: boolean;
  /** git gutter 基线（HEAD 版本全文）：null = 未就绪；"" = 未跟踪新文件（整文件新增） */
  gitBase: string | null;
}

const STATUS_CLS: Record<string, string> = { M: "gs-M", A: "gs-A", D: "gs-D", R: "gs-R", U: "gs-U", "?": "gs-Q" };
const STATUS_LETTER: Record<string, string> = { M: "M", A: "A", D: "D", R: "R", U: "U", "?": "?" };

export interface EditorPaneProps {
  tabs: EditorTab[];
  activeTab: string | null;
  /** path → git 状态码（标签名着色 + 页脚徽标） */
  statusByPath: Record<string, string | null>;
  /** git 行级 diff 高亮开关（文件树「变更」模式才开） */
  showDiff?: boolean;
  onActivateTab: (path: string) => void;
  onPinTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onQuickOpen: () => void;
  onToggleSidebar: () => void;
  /** 面包屑点击 → 请求树中揭示当前文件（FilesPage 递增 revealTick） */
  onReveal?: () => void;
  /** 保存成功 → FilesPage 重拉 repo.tree（树状态色 + 页脚 git 字母实时化） */
  onSaved?: () => void;
  /** 标签拖拽排序（from 拖到 to 的位置） */
  onMoveTab?: (from: string, to: string) => void;
  /** 固定/取消固定标签 */
  onTogglePin?: (path: string) => void;
  /** 暂存单文件（tab 菜单）：成功返回 true */
  onStageFile?: (path: string) => Promise<boolean>;
  /** 放弃单文件未提交修改（tab 菜单，编辑器侧确认后调用）：成功返回 true，随后编辑器重载磁盘版 */
  onDiscardFile?: (path: string) => Promise<boolean>;
  /** 外部文件拖入（绝对路径）：FilesPage 换算仓库相对路径后打开 */
  onOpenDropped?: (absPath: string) => void;
  /** 全局搜索结果定位（path+line；ts 防重） */
  reveal?: { path: string; line: number; ts: number } | null;
  /** 外部变更信号（fs.changed 防抖后递增）：批量校验打开标签 mtime */
  fsTick?: number;
}

/** 文件树侧文件系统操作（重命名/删除/剪切移动）发生后，FilesPage 经 ref 调用同步编辑器 */
export interface EditorPaneHandle {
  /** 文件/目录重命名（含剪切粘贴的移动）：标签、model（脏内容保留）、LSP 会话、定时器随路径迁移 */
  handleFsRenamed(oldPath: string, newPath: string, isDir: boolean): void;
  /** 文件/目录删除：清理受影响标签的 model、LSP 会话与定时器（标签移除归 FilesPage） */
  handleFsDeleted(path: string, isDir: boolean): void;
}

/** 受影响路径判定：精确命中，或目录前缀下的全部后代 */
function fsAffected(root: string, isDir: boolean, p: string): boolean {
  return p === root || (isDir && p.startsWith(root + "/"));
}

/** 路径迁移映射：目录按前缀整体改写，文件精确替换 */
function fsRemap(p: string, oldPath: string, newPath: string, isDir: boolean): string {
  return isDir ? newPath + p.slice(oldPath.length) : newPath;
}

interface ProblemRow {
  path: string;
  line: number;
  col: number;
  severity: number;
  message: string;
}

export const EditorPane = forwardRef<EditorPaneHandle, EditorPaneProps>(function EditorPane(props, ref) {
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

  // 文本模式覆盖：查看器接管的路径（md 预览等）被用户要求回 Monaco 编辑——
  // 覆盖登记后画布走文本流，预览 HUD 可切回。ref 镜像供 loadFile 守卫同步读。
  const [textMode, setTextMode] = useState<Set<string>>(new Set());
  const textModeRef = useRef<Set<string>>(textMode);
  textModeRef.current = textMode;

  // 编码重开确认（脏文件）/ 放弃修改确认 / HEAD 差异弹窗
  const [confirmReopen, setConfirmReopen] = useState<{ path: string; enc: Encoding } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);
  const [headDiff, setHeadDiff] = useState<{ path: string; diff: DiffDTO } | null>(null);

  // 问题面板 + marker 变化版本号（onAnyMarkers 全局订阅触发重算）
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [markerTick, setMarkerTick] = useState(0);
  useEffect(() => {
    const d = onAnyMarkers(() => setMarkerTick((v) => v + 1));
    return () => d.dispose();
  }, []);

  // 缩进（探测/切换后记忆，随 model 选项联动；键为路径）
  const [indentByPath, setIndentByPath] = useState<Map<string, { insertSpaces: boolean; tabSize: number }>>(new Map());

  // 分屏（右栏展示的路径；同 model 双实例，编辑互通）
  const [splitPath, setSplitPath] = useState<string | null>(null);
  const mainEditorRef = useRef<FilesMonacoEditorHandle | null>(null);

  // 问题点击的本地定位（与 props.reveal——全局搜索定位——合并后下发主编辑器）
  const [localReveal, setLocalReveal] = useState<{ path: string; line: number; ts: number } | null>(null);

  // editors 的 ref 镜像（fsTick 等低频回调读取最新脏态，不进依赖）
  const editorsRef = useRef(editors);
  editorsRef.current = editors;
  // 脏标签外部修改提示去重（一次变更只提示一次，保存/重载后解除）
  const externToasted = useRef(new Set<string>());

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

  /** 该路径是否走 Monaco 文本流（查看器接管且未切文本模式的路径无 model） */
  const isTextual = useCallback((p: string | null): p is string =>
    !!p && (!viewerForPath(p) || textModeRef.current.has(p)), []);

  // 加载文件内容（画布查看器接管的路径——office 预览等——不走文本流，无 model/脏态；
  // 被文本模式覆盖的查看器路径除外）。encoding：以指定编码重新打开（缺省自动嗅探）。
  const loadFile = useCallback(async (path: string, encoding?: Encoding) => {
    if ((viewerForPath(path) && !textModeRef.current.has(path)) || models.current.has(path)) return; // 已加载（keep-alive）

    setEditors((prev) => {
      const next = new Map(prev);
      next.set(path, {
        path, content: "", originalContent: "", eol: "lf", mtime: 0,
        encoding: encoding ?? "utf8", bom: false,
        dirty: false, loading: true, binary: false, error: null, truncated: false, gitBase: null,
      });
      return next;
    });

    try {
      const r = await pageSdk.call<{
        content: string; eol: "crlf" | "lf"; size: number; mtime: number;
        encoding: Encoding; bom: boolean; binary: boolean; truncated: boolean;
      } | null>("file.content", { path, encoding });

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
      // 缩进按内容探测（页脚可改，仅影响本文件的编辑行为）
      const indent = detectIndent(r.content);
      model.updateOptions(indent);
      setIndentByPath((prev) => {
        const next = new Map(prev);
        next.set(path, indent);
        return next;
      });
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
          ed.encoding = r.encoding;
          ed.bom = r.bom;
          ed.mtime = r.mtime;
          ed.dirty = false;
          ed.truncated = r.truncated;
          ed.error = r.truncated ? t("Editor_ErrorTruncated") : null;
        }
        return next;
      });
      externToasted.current.delete(path);

      // git gutter 基线：HEAD 版本全文（未跟踪新文件 git show 失败 → ""，整文件新增）
      void pageSdk.call<{ content: string } | null>("file.content", { path, revision: "HEAD" })
        .then((base) => {
          setEditors((prev) => {
            const next = new Map(prev);
            const ed = next.get(path);
            if (ed) ed.gitBase = base ? base.content : "";
            return next;
          });
        })
        .catch(() => {
          setEditors((prev) => {
            const next = new Map(prev);
            const ed = next.get(path);
            if (ed) ed.gitBase = "";
            return next;
          });
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

  /** 从磁盘整体重载（丢弃前端 model 缓存）：外部修改的干净标签 / 放弃修改 / 编码重开共用 */
  const reloadFile = useCallback(async (path: string, encoding?: Encoding) => {
    const timer = saveTimers.current.get(path);
    if (timer !== undefined) { window.clearTimeout(timer); saveTimers.current.delete(path); }
    documentClosed(path);
    disposeTextModel(models.current.get(path) ?? null);
    models.current.delete(path);
    await loadFile(path, encoding);
  }, [loadFile]);

  // 查看器回退卡请求切文本：登记覆盖并补加载 model（查看器路径平时不走文本流；
  // ref 先行更新——loadFile 守卫读的是 ref 而非本轮 state）
  const requestTextMode = useCallback((path: string) => {
    if (!textModeRef.current.has(path)) {
      const next = new Set(textModeRef.current);
      next.add(path);
      textModeRef.current = next;
      setTextMode(next);
    }
    void loadFile(path);
  }, [loadFile]);
  const exitTextMode = useCallback((path: string) => {
    const next = new Set(textModeRef.current);
    next.delete(path);
    textModeRef.current = next;
    setTextMode(next);
  }, []);

  // 保存文件（带 mtime 冲突检测；按读取时的编码 + BOM 写回）
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
        "file.write", { path, content, eol: editor.eol, encoding: editor.encoding, bom: editor.bom });
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
      externToasted.current.delete(path);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // 文本模式覆盖随标签消亡：重开该文件恢复默认（查看器/预览优先）
    const next = new Set(textModeRef.current);
    if (next.delete(path)) { textModeRef.current = next; setTextMode(next); }
    props.onCloseTab(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 关闭请求：含未保存更改 → 三选一确认（保存/不保存/取消）
  const requestClose = useCallback((path: string | null) => {
    if (!path) return;
    if (editors.get(path)?.dirty) { setConfirmClose(path); return; }
    closeTabImpl(path);
  }, [editors, closeTabImpl]);

  // ---- 文件系统操作同步（FilesPage 经 ref 调用；树内右键/键盘的重命名/删除/剪切）----

  /** 重命名/移动：新 model 以当前值（含未保存内容）建在新 URI 下，旧 model 才 dispose；
   *  LSP 走 didClose→didOpen 换档；自动保存定时器与文本模式覆盖随路径迁移。 */
  const handleFsRenamed = useCallback((oldPath: string, newPath: string, isDir: boolean) => {
    for (const p of [...models.current.keys()]) {
      if (!fsAffected(oldPath, isDir, p)) continue;
      const np = fsRemap(p, oldPath, newPath, isDir);
      const model = models.current.get(p)!;
      const value = model.getValue();
      const nModel = createTextModel(np, value);
      models.current.set(np, nModel);
      models.current.delete(p);
      documentClosed(p);
      documentOpened(np, languageForPath(np), value, nModel);
      const timer = saveTimers.current.get(p);
      if (timer !== undefined) { saveTimers.current.delete(p); saveTimers.current.set(np, timer); }
      setEditors((prev) => {
        const ed = prev.get(p);
        if (!ed) return prev;
        const next = new Map(prev);
        next.delete(p);
        next.set(np, { ...ed, path: np });
        return next;
      });
      setIndentByPath((prev) => {
        const ind = prev.get(p);
        if (!ind) return prev;
        const next = new Map(prev);
        next.delete(p);
        next.set(np, ind);
        return next;
      });
    }
    const nextTextMode = new Set<string>();
    for (const p of textModeRef.current) nextTextMode.add(fsAffected(oldPath, isDir, p) ? fsRemap(p, oldPath, newPath, isDir) : p);
    textModeRef.current = nextTextMode;
    setTextMode(nextTextMode);
  }, []);

  /** 删除：清定时器 + LSP didClose + dispose model + 清编辑态（标签移除由 FilesPage 做） */
  const handleFsDeleted = useCallback((path: string, isDir: boolean) => {
    for (const p of [...models.current.keys()]) {
      if (!fsAffected(path, isDir, p)) continue;
      const timer = saveTimers.current.get(p);
      if (timer !== undefined) { window.clearTimeout(timer); saveTimers.current.delete(p); }
      documentClosed(p);
      disposeTextModel(models.current.get(p) ?? null);
      models.current.delete(p);
      setEditors((prev) => {
        if (!prev.has(p)) return prev;
        const next = new Map(prev);
        next.delete(p);
        return next;
      });
      setIndentByPath((prev) => {
        if (!prev.has(p)) return prev;
        const next = new Map(prev);
        next.delete(p);
        return next;
      });
    }
    const nextTextMode = new Set<string>([...textModeRef.current].filter((p) => !fsAffected(path, isDir, p)));
    textModeRef.current = nextTextMode;
    setTextMode(nextTextMode);
  }, []);

  useImperativeHandle(ref, () => ({ handleFsRenamed, handleFsDeleted }), [handleFsRenamed, handleFsDeleted]);

  // 记录最后一个就绪的 model：新文件加载期保留其画面（Monaco 不卸载，防闪黑）；
  // 已关闭标签的 model 被 dispose，不再作为保底
  useEffect(() => {
    if (!props.activeTab) return;
    const m = models.current.get(props.activeTab);
    if (m) lastReady.current = { path: props.activeTab, model: m };
  }, [props.activeTab, editors]);

  // 批量关闭（关闭其他/右侧/全部）：固定标签跳过；未保存的标签保留并提示，不静默丢改动
  const batchClose = useCallback((targets: string[]) => {
    const closable = targets.filter((p) => {
      const tab = props.tabs.find((x) => x.path === p);
      return !tab?.pinned;
    });
    const dirtyKept = closable.filter((p) => editors.get(p)?.dirty).length;
    for (const p of closable) {
      if (!editors.get(p)?.dirty) closeTabImpl(p);
    }
    if (dirtyKept > 0) pageSdk.toast(t("Editor_TabClose"), t("Editor_KeptDirty", dirtyKept));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editors, closeTabImpl, props.tabs, t]);

  // HEAD 差异弹窗（tab 菜单「与 HEAD 比较差异」）：复用 changes.diffFile 工作区档
  const openHeadDiff = useCallback(async (path: string) => {
    try {
      const d = await pageSdk.call<DiffDTO>("changes.diffFile", { path, staged: false });
      setHeadDiff({ path, diff: d });
    } catch (e) {
      pageSdk.toast(t("Editor_DiffHead"), (e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  // 标签右键菜单：固定/分屏 / 关闭组 / git 组（暂存/放弃/HEAD差异）/ 关闭其他与全部
  const tabMenu = useCallback((path: string): CtxMenuItem[] => {
    const tab = props.tabs.find((x) => x.path === path);
    const idx = props.tabs.findIndex((x) => x.path === path);
    const textual = isTextual(path);
    const items: CtxMenuItem[] = [
      { label: tab?.pinned ? t("Editor_UnpinTab") : t("Editor_PinTab"), action: () => props.onTogglePin?.(path) },
      ...(textual ? [{ label: t("Editor_OpenInSplit"), action: () => setSplitPath(path) }] : []),
      { sep: true },
      { label: t("Editor_TabClose"), hint: "Ctrl+W", action: () => requestClose(path) },
      { label: t("Editor_TabCloseOthers"), action: () => batchClose(props.tabs.filter((x) => x.path !== path).map((x) => x.path)) },
      { label: t("Editor_TabCloseRight"), action: () => batchClose(props.tabs.slice(idx + 1).map((x) => x.path)) },
      { label: t("Editor_TabCloseAll"), action: () => batchClose(props.tabs.map((x) => x.path)) },
      { sep: true },
      { label: t("Editor_StageFile"), action: () => void props.onStageFile?.(path) },
      { label: t("Editor_DiscardFile"), action: () => setConfirmDiscard(path) },
      { label: t("Editor_DiffHead"), action: () => void openHeadDiff(path) },
    ];
    return items;
  }, [props.tabs, props.onTogglePin, props.onStageFile, requestClose, batchClose, isTextual, openHeadDiff, t]);

  // 切换标签时确保 model 已加载
  useEffect(() => {
    if (props.activeTab) void loadFile(props.activeTab);
  }, [props.activeTab, loadFile]);

  // 分屏文件确保加载（viewer 接管路径不允许进分屏，入口已挡）
  useEffect(() => {
    if (splitPath) void loadFile(splitPath);
  }, [splitPath, loadFile]);

  // 分屏文件被关闭 → 分屏同步收起
  useEffect(() => {
    if (splitPath && !props.tabs.some((tb) => tb.path === splitPath)) setSplitPath(null);
  }, [props.tabs, splitPath]);

  // 外部变更信号：批量 stat 打开标签——干净标签自动重载，脏标签提示一次（保存时有冲突检测兜底）
  useEffect(() => {
    if (!props.fsTick) return;
    const paths = [...models.current.keys()];
    if (paths.length === 0) return;
    let cancelled = false;
    void pageSdk.call<{ path: string; mtime: number }[] | null>("file.statMany", { paths })
      .then((stats) => {
        if (cancelled || !stats) return;
        const fresh = new Map(stats.map((s) => [s.path, s.mtime]));
        for (const [p] of models.current) {
          const fm = fresh.get(p);
          if (fm === undefined) continue; // 已消失的文件不动，等树刷新/用户操作
          const ed = editorsRef.current.get(p);
          if (!ed || ed.binary || ed.loading || fm === ed.mtime) continue;
          if (ed.dirty) {
            if (!externToasted.current.has(p)) {
              externToasted.current.add(p);
              pageSdk.toast(t("Files_Title"), t("Editor_ExternalChangedDirty", p.split("/").pop() ?? p));
            }
          } else {
            void reloadFile(p);
          }
        }
      })
      .catch(() => { /* stat 失败静默（仓库正在大量变动，下一轮 fsTick 再校） */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fsTick, reloadFile, t]);

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

  // 编码重开（干净直接重载；脏文件先确认）
  const requestReopen = useCallback((path: string, enc: Encoding) => {
    if (editors.get(path)?.dirty) { setConfirmReopen({ path, enc }); return; }
    void reloadFile(path, enc);
  }, [editors, reloadFile]);

  // EOL 互转（页脚点击）：改 model EOL + 走一次内容变更链（脏标 + 自动保存 + LSP）
  const switchEol = useCallback((path: string) => {
    const ed = editors.get(path);
    const model = models.current.get(path);
    if (!ed || !model) return;
    const crlf = ed.eol !== "crlf";
    model.setEOL(crlf ? MonacoNs.editor.EndOfLineSequence.CRLF : MonacoNs.editor.EndOfLineSequence.LF);
    setEditors((prev) => {
      const next = new Map(prev);
      const e = next.get(path);
      if (e) e.eol = crlf ? "crlf" : "lf";
      return next;
    });
    handleContentChange(path, model.getValue());
  }, [editors, handleContentChange]);

  // 缩进切换（页脚菜单）：改 model 选项（不触碰文件内容）
  const applyIndent = useCallback((path: string, insertSpaces: boolean, tabSize: number) => {
    models.current.get(path)?.updateOptions({ insertSpaces, tabSize });
    setIndentByPath((prev) => {
      const next = new Map(prev);
      next.set(path, { insertSpaces, tabSize });
      return next;
    });
  }, []);

  // 问题面板数据：全部打开 model 的 marker 聚合（markerTick 触发重算）
  const problemRows = useMemo<ProblemRow[]>(() => {
    if (!problemsOpen) return [];
    const rows: ProblemRow[] = [];
    for (const [p, m] of models.current) {
      for (const mk of markersOf(m)) {
        rows.push({ path: p, line: mk.startLineNumber, col: mk.startColumn, severity: mk.severity, message: mk.message });
      }
    }
    rows.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problemsOpen, markerTick, props.tabs, editors]);

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
          <div className="wrow" onClick={() => props.onQuickOpen}>
            <span className="nm2">{t("Files_GlobalSearch")}</span>
            <kbd className="kbd">Ctrl</kbd><kbd className="kbd">Shift</kbd><kbd className="kbd">F</kbd>
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
  // 画布查看器（office 预览等）接管：命中即替换 Monaco 画布，标签条/面包屑/页脚不变；
  // 文本模式覆盖的路径（md 切回编辑）不接管
  const ActiveViewer = props.activeTab && !textMode.has(props.activeTab) ? viewerForPath(props.activeTab) : null;
  const crumbs = props.activeTab ? props.activeTab.split("/") : [];
  const lang = props.activeTab ? languageLabel(languageForPath(props.activeTab)) : "";
  const indent = props.activeTab ? indentByPath.get(props.activeTab) : undefined;
  const encLabel = activeEditor && !activeEditor.binary
    ? `${activeEditor.encoding.toUpperCase()}${activeEditor.bom ? " BOM" : ""}`
    : "UTF-8";
  // 定位请求合并：问题面板本地定位优先，其次全局搜索定位（都按当前激活标签过滤）
  const revealLine = (localReveal && localReveal.path === props.activeTab ? localReveal : null)
    ?? (props.reveal && props.reveal.path === props.activeTab ? props.reveal : null);
  const splitEditor = splitPath ? editors.get(splitPath) : null;
  const splitModel = splitPath ? (models.current.get(splitPath) ?? null) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* 标签条（家内 chip：活动 = panel2 + 描边环；× hover/活动显，脏点其余显；拖拽排序） */}
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
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/gitter-tab", tab.path);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => { if (e.dataTransfer.types.includes("text/gitter-tab")) e.preventDefault(); }}
                onDrop={(e) => {
                  const from = e.dataTransfer.getData("text/gitter-tab");
                  if (from && from !== tab.path) props.onMoveTab?.(from, tab.path);
                }}
                onClick={(e) => {
                  // Alt+点击 = 送入分屏右栏（文本文件）；普通点击激活
                  if (e.altKey && isTextual(tab.path)) { setSplitPath(tab.path); return; }
                  props.onActivateTab(tab.path);
                }}
                onDoubleClick={() => props.onPinTab(tab.path)}
                onAuxClick={(e) => { if (e.button === 1) requestClose(tab.path); }}
                onContextMenu={(e) => showMenu(e, tabMenu(tab.path))}
              >
                <span className="fico"><FileIcon path={tab.path} /></span>
                <span className={nmCls}>{nameOf(tab.path)}</span>
                {isDirty && <span className="dot" title={t("Editor_Unsaved")} />}
                {tab.pinned ? (
                  <span
                    className="x"
                    title={t("Editor_UnpinTab")}
                    onClick={(e) => { e.stopPropagation(); props.onTogglePin?.(tab.path); }}
                  >
                    <PinIcon />
                  </span>
                ) : (
                  <span
                    className="x"
                    title={t("Editor_TabClose")}
                    onClick={(e) => { e.stopPropagation(); requestClose(tab.path); }}
                  >
                    <CloseIcon />
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div className="edtabs-acts">
          {saving && <span className="saving">{t("Editor_Saving")}</span>}
          <button
            className="files-ibtn"
            title={splitPath ? t("Editor_SplitOff") : t("Editor_Split")}
            disabled={!isTextual(props.activeTab)}
            onClick={() => {
              if (splitPath) { setSplitPath(null); return; }
              if (isTextual(props.activeTab)) setSplitPath(props.activeTab);
            }}
          >
            <SplitIcon />
          </button>
          <button className="files-ibtn" title={t("Files_QuickOpen")} onClick={props.onQuickOpen}><SearchIcon /></button>
        </div>
      </div>

      {/* 面包屑：路径段（点击 → 树中揭示）；最右侧 = 转到符号 + 外部预览（md/html）/源码切换（图标互斥） */}
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
        <div className="edcrumbs-acts">
          {props.activeTab && isTextual(props.activeTab) && (
            <button
              className="files-ibtn"
              title={t("Editor_Outline")}
              onClick={() => mainEditorRef.current?.runAction("editor.action.quickOutline")}
            >
              <OutlineIcon />
            </button>
          )}
          {props.activeTab && textMode.has(props.activeTab) && viewerForPath(props.activeTab) ? (
            <button className="files-ibtn" title={t("Editor_PreviewMode")} onClick={() => exitTextMode(props.activeTab!)}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M1.3 8C2.2 5.9 4.8 3.5 8 3.5S13.8 5.9 14.7 8c-.9 2.1-3.5 4.5-6.7 4.5S2.2 10.1 1.3 8Z" stroke="currentColor" strokeWidth="1.2" />
                <circle cx="8" cy="8" r="1.9" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </button>
          ) : props.activeTab && !textMode.has(props.activeTab) && isExternalPreviewPath(props.activeTab) ? (
            <button className="files-ibtn" title={t("Editor_EditSource")} onClick={() => requestTextMode(props.activeTab!)}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M11.3 2.1a1.4 1.4 0 0 1 2 2L6 11.4l-2.8.8.8-2.8 7.3-7.3Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                <path d="M2.5 14h11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      {/* 编辑区：Monaco 实例常驻（新文件加载期保留上一个画面 + Loading 覆盖层，
          不卸载重建——实例重挂是选中文件时「闪黑」的根因）。
          画布查看器（office 预览）命中时接管整个画布；分屏开启时左右双栏。 */}
      <div
        style={{ flex: 1, overflow: "hidden", position: "relative", minHeight: 0, display: "flex" }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          for (const f of Array.from(e.dataTransfer.files)) {
            const abs = pageSdk.pathForFile(f);
            if (abs) props.onOpenDropped?.(abs);
          }
        }}
      >
        <div style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden" }}>
          {ActiveViewer && props.activeTab ? (
            <ActiveViewer
              key={props.activeTab}
              path={props.activeTab}
              onEditText={requestTextMode}
            />
          ) : activeEditor && activeEditor.binary ? (
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
                    ref={mainEditorRef}
                    model={shown}
                    readOnly={stale}
                    ownsKeys={!stale}
                    gitBase={stale ? null : activeEditor?.gitBase ?? null}
                    showDiff={props.showDiff}
                    revealLine={revealLine}
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

        {/* 分屏右栏：同 model 双实例（编辑互通），自带标题条；Alt+点击标签送入 */}
        {splitPath && (
          <div
            style={{
              width: "50%", minWidth: 240, flex: "none", display: "flex", flexDirection: "column",
              borderLeft: "1px solid var(--c-line, rgba(128,128,128,0.25))", background: editorBg, minHeight: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 8px", fontSize: 12, opacity: 0.8, flex: "none" }}>
              <span className="fico"><FileIcon path={splitPath} /></span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={splitPath}>{nameOf(splitPath)}</span>
              {splitEditor?.dirty && <span className="dot" title={t("Editor_Unsaved")} />}
              <span
                className="x"
                title={t("Editor_SplitOff")}
                style={{ display: "inline-flex", cursor: "pointer" }}
                onClick={() => setSplitPath(null)}
              >
                <CloseIcon />
              </span>
            </div>
            <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
              {splitModel ? (
                <FilesMonacoEditor
                  model={splitModel}
                  gitBase={splitEditor?.gitBase ?? null}
                  showDiff={props.showDiff}
                  onChange={(value) => { if (splitPath) handleContentChange(splitPath, value); }}
                />
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", opacity: 0.7 }}>Loading…</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 问题面板：全部打开文件的诊断聚合，点击定位到行 */}
      {problemsOpen && (
        <div style={{ flex: "none", height: 160, borderTop: "1px solid var(--c-line, rgba(128,128,128,0.25))", display: "flex", flexDirection: "column", background: editorBg }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", fontSize: 12, opacity: 0.8, flex: "none" }}>
            <span style={{ flex: 1 }}>{t("Editor_ProblemsTitle")}</span>
            <span className="x" style={{ display: "inline-flex", cursor: "pointer" }} title={t("Common_Close")} onClick={() => setProblemsOpen(false)}>
              <CloseIcon />
            </span>
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "0 10px 8px" }}>
            {problemRows.length === 0 ? (
              <div style={{ opacity: 0.6, fontSize: 12, padding: "6px 2px" }}>{t("Editor_NoProblems")}</div>
            ) : problemRows.map((r, i) => (
              <div
                key={`${r.path}:${r.line}:${i}`}
                className="cseg"
                style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "2px 4px", borderRadius: 4, cursor: "pointer", fontSize: 12 }}
                title={`${r.path}:${r.line}:${r.col}`}
                onClick={() => {
                  props.onActivateTab(r.path);
                  setLocalReveal({ path: r.path, line: r.line, ts: Date.now() });
                }}
              >
                <span style={{ color: r.severity === 1 ? "var(--c-red, #e5534b)" : r.severity === 2 ? "var(--c-yellow, #d4a72c)" : "var(--c-link, #4493f8)", flex: "none" }}>●</span>
                <span style={{ flex: "none", opacity: 0.75 }}>{nameOf(r.path)}:{r.line}:{r.col}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 页脚状态条：问题 / 光标 / 缩进 / 编码 / EOL / 语言 / git 状态 */}
      <div className="edfoot">
        {savedAt ? (
          <span className="it" title={t("Editor_Saved")}>
            <span className="ok"><CheckIcon /></span> {t("Editor_Saved")} · {savedAt}
          </span>
        ) : (
          <span
            className="it"
            title={t("Editor_ProblemsTitle")}
            style={{ cursor: "pointer" }}
            onClick={() => setProblemsOpen((v) => !v)}
          >
            <span className="ok"><CheckIcon /></span> {t("Editor_Problems", markers.errors, markers.warnings)}
          </span>
        )}
        <div className="right">
          <span className="it">Ln {position.line}, Col {position.col}</span>
          <span
            className="it"
            title={t("Editor_Indent")}
            style={{ cursor: "pointer" }}
            onClick={(e) => {
              if (!props.activeTab) return;
              const cur = indent ?? { insertSpaces: true, tabSize: 4 };
              showMenu(e, [
                { label: t("Editor_Spaces", 2), action: () => applyIndent(props.activeTab!, true, 2) },
                { label: t("Editor_Spaces", 4), action: () => applyIndent(props.activeTab!, true, 4) },
                { label: t("Editor_Spaces", 8), action: () => applyIndent(props.activeTab!, true, 8) },
                { sep: true },
                { label: t("Editor_TabsIndent"), action: () => applyIndent(props.activeTab!, false, 4) },
              ]);
              void cur;
            }}
          >
            {indent ? (indent.insertSpaces ? t("Editor_Spaces", indent.tabSize) : t("Editor_TabsIndent")) : t("Editor_Spaces", 4)}
          </span>
          <span
            className="it"
            title={t("Editor_EncodingTitle")}
            style={{ cursor: activeEditor && !activeEditor.binary ? "pointer" : undefined }}
            onClick={(e) => {
              if (!props.activeTab || !activeEditor || activeEditor.binary) return;
              showMenu(e, [
                { label: "UTF-8" + (activeEditor.encoding === "utf8" ? " ✓" : ""), action: () => requestReopen(props.activeTab!, "utf8") },
                { label: "GBK" + (activeEditor.encoding === "gbk" ? " ✓" : ""), action: () => requestReopen(props.activeTab!, "gbk") },
                { sep: true },
                { label: t("Editor_ReopenTitle"), disabled: true },
              ]);
            }}
          >
            {encLabel}
          </span>
          <span
            className="it"
            title={t("Editor_EolTitle")}
            style={{ cursor: "pointer" }}
            onClick={() => { if (props.activeTab) switchEol(props.activeTab); }}
          >
            {(activeEditor?.eol ?? "lf").toUpperCase()}
          </span>
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

      {/* 编码重开（脏文件）：丢弃未保存内容从磁盘按新编码重读 */}
      {confirmReopen && (
        <Modal
          title={t("Editor_ReopenTitle")}
          confirmText={t("Editor_Reload")}
          onClose={() => setConfirmReopen(null)}
          onConfirm={() => {
            const { path, enc } = confirmReopen;
            setConfirmReopen(null);
            void reloadFile(path, enc);
          }}
        >
          <div>{t("Editor_ReopenDirty", nameOf(confirmReopen.path))}</div>
        </Modal>
      )}

      {/* 放弃修改（未提交内容不可恢复）：确认后交主进程 checkout/删除，随后编辑器重载磁盘版 */}
      {confirmDiscard && (
        <Modal
          title={t("Editor_DiscardConfirmTitle")}
          danger
          confirmText={t("Editor_DiscardFile")}
          onClose={() => setConfirmDiscard(null)}
          onConfirm={() => {
            const p = confirmDiscard;
            setConfirmDiscard(null);
            void props.onDiscardFile?.(p).then((ok) => { if (ok) void reloadFile(p); });
          }}
        >
          <div>{t("Editor_DiscardConfirmBody", nameOf(confirmDiscard))}</div>
        </Modal>
      )}

      {/* HEAD 差异弹窗：DiffView 工作区 vs HEAD */}
      {headDiff && (
        <Modal
          title={`${t("Editor_DiffHead")} · ${nameOf(headDiff.path)}`}
          width={900}
          confirmText={t("Common_Close")}
          onClose={() => setHeadDiff(null)}
          onConfirm={() => setHeadDiff(null)}
        >
          <div style={{ maxHeight: "65vh", overflow: "auto" }}>
            <DiffView diff={headDiff.diff} inline />
          </div>
        </Modal>
      )}
      {menuElement}
    </div>
  );
});

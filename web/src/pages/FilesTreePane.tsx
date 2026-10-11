import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useContextMenu, Modal, type CtxMenuItem } from "../kit";
import { pageSdk } from "../pageSdk";
import { absPathOf } from "./filesPaths";
import { ChevronIcon, CloseIcon, CollapseAllIcon, CopyIcon, CutIcon, DiffIcon, ExpandAllIcon, FileIcon, FilterIcon, FolderIcon, NewFileIcon, NewFolderIcon, OpenExternalIcon, PasteIcon, PencilIcon, RefreshIcon, RevealIcon, SparkIcon, TrashIcon } from "./filesIcons";

/**
 * 文件树组件（files-editor-redesign-mockup.html §二/§三，P2）：
 * 树头（标题 + 变更/回合/全部模式 tabs + 悬停动作钮）+ 筛选行 + 虚拟化树体。
 * 行：24px 无行线 + 缩进参考线 + chevron 旋转 + 类型着色图标 + git 状态着色/字母徽标
 * + agent 回合左缘紫 bar + ✦ 徽标；键盘 ↑↓/Enter/←→/F2/Del/Ctrl+C·X·V；右键菜单带图标
 * 与键位提示（打开/差异/新建/重命名/删除/复制剪切粘贴/复制路径/外部打开/资源管理器），
 * 树体空白处右键 = 根目录的新建与粘贴。删除走 Modal 确认（目录递归、不可恢复）。
 * 过滤态（query / git / agent）下目录节点按文件路径祖先合成并强制全展开；
 * 「全部」模式记忆折叠状态。数据契约（TreeEntry / repo.tree）不变。
 */

export interface TreeEntry {
  path: string;
  isDir: boolean;
  /** git 状态码 (M/A/D/R/U/?)；null = 未改动 */
  status: string | null;
  /** 是否被 agent 本回合碰过 */
  touchedByAgent: boolean;
}

/** 行高（虚拟化定高） */
const ROW_H = 24;

/** git 状态码 → 着色类（styles.css .gs-*）与字母徽标 */
const STATUS_CLS: Record<string, string> = { M: "gs-M", A: "gs-A", D: "gs-D", R: "gs-R", U: "gs-U", "?": "gs-Q" };
const STATUS_LETTER: Record<string, string> = { M: "M", A: "A", D: "D", R: "R", U: "U", "?": "?" };
/** 目录继承后代状态时的严重度优先序（U/D > M/A > R > ?） */
const DIR_PRIO = ["U", "D", "M", "A", "R", "?"];

type FilterMode = "all" | "git";

/** 行内草稿：create = 挂 dir 下新建 kind；rename = 对 renameOf（相对根）原地改名 */
interface Draft {
  dir: string;
  kind: "file" | "dir";
  mode: "create" | "rename";
  renameOf?: string;
}

/** 树内文件剪贴板（复制/剪切暂存一次一个；粘贴成功且为剪切后清空） */
interface Clip {
  path: string;
  isDir: boolean;
  cut: boolean;
}

/** 草稿行占位 path（\0 前缀不可能与真实路径撞；键盘导航/揭示按 path 找行时自然跳过） */
const DRAFT_PATH = "\0draft";

interface VisibleNode {
  entry: TreeEntry;
  depth: number;
  /** 目录节点合成时继承的状态色（null = 中性） */
  dirStatus: string | null;
  open: boolean;
  /** 行内新建输入行（非真实条目，不参与打开/右键） */
  draft?: boolean;
}

/** Windows 名称段校验（与主进程 file.create 同规则）：非法字符/结尾点空格/保留设备名/.git */
export function nameValidationError(name: string): boolean {
  return (
    !name ||
    name.length > 255 ||
    name.toLowerCase() === ".git" ||
    /[\\/:*?"<>|\u0000-\u001f]/.test(name) ||
    /[.\s]$/.test(name) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name)
  );
}

export function TreePane(props: {
  entries: TreeEntry[];
  activePath: string | null;
  onOpenFile: (path: string, opts?: { preview?: boolean }) => void;
  /** 行内新建提交（dir 相对根，name 单段名）：成功返回 true（关输入行），失败已 toast */
  onCreate: (dir: string, name: string, kind: "file" | "dir") => Promise<boolean>;
  /** 右键/键盘重命名（同目录单段名）：成功返回 true；失败已 toast */
  onRename?: (path: string, newName: string, isDir: boolean) => Promise<boolean>;
  /** 右键/键盘删除（目录递归、不可恢复）：成功返回 true；失败已 toast */
  onDelete?: (path: string, isDir: boolean) => Promise<boolean>;
  /** 粘贴（from 复制/剪切到 toDir 下）：成功返回落定相对路径或 true；失败已 toast */
  onPaste?: (from: string, toDir: string, cut: boolean, fromIsDir: boolean) => Promise<string | boolean>;
  loading: boolean;
  onRefresh: () => void;
  /** 树模式切换上报（FilesPage 据此开关编辑器 git 行级 diff 高亮） */
  onModeChange?: (mode: "all" | "git") => void;
  /** 面包屑点击等场景的「重新揭示当前文件」信号（activePath 不变也要滚动+闪光） */
  revealTick?: number;
}) {
  const t = pageSdk.t;
  const [mode, setMode] = useState<FilterMode>("all");
  const [filterOn, setFilterOn] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // 行内新建/重命名草稿（挂载点 + 名称输入）
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftName, setDraftName] = useState("");
  const draftInputRef = useRef<HTMLInputElement | null>(null);
  // 树内文件剪贴板（复制/剪切一次一个；会话内有效，不与系统剪贴板互通）
  const [clip, setClip] = useState<Clip | null>(null);
  // 删除确认（目录递归且不入回收站，Modal 二次确认）
  const [confirmDel, setConfirmDel] = useState<{ path: string; isDir: boolean } | null>(null);
  // 目录选中态（点击行记忆，供树头新建按钮定位目标目录；文件行的选中 = 激活标签）
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // 键盘导航锚点（kbFocus）+ 描边可见性（kbKey：仅键盘操作时显示描边，鼠标点击不闪边框）
  const [kbFocus, setKbFocus] = useState<string | null>(null);
  const [kbKey, setKbKey] = useState(false);
  const parentRef = useRef<HTMLDivElement | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);

  const { showMenu, menuElement } = useContextMenu();

  // 过滤：模式 + 名称筛选（筛选在 path 上匹配，命中子串在 basename 上高亮）
  const q = query.trim().toLowerCase();
  const files = useMemo(() => {
    let fs = props.entries.filter((e) => !e.isDir);
    if (mode === "git") fs = fs.filter((f) => f.status !== null);
    if (q) fs = fs.filter((f) => f.path.toLowerCase().includes(q));
    return fs;
  }, [props.entries, mode, q]);
  const forceOpen = mode !== "all" || q !== "";
  const counts = useMemo(() => ({
    git: props.entries.filter((e) => !e.isDir && e.status !== null).length,
  }), [props.entries]);

  // 扁平化可见节点（目录 = 文件路径全部祖先合成；目录状态色按严重度继承）
  const visibleNodes = useMemo<VisibleNode[]>(() => {
    const nodes: VisibleNode[] = [];
    const dirStatus = new Map<string, string | null>();
    const filesByDir = new Map<string, TreeEntry[]>();
    for (const f of files) {
      const parts = f.path.split("/");
      // 逐层登记全部祖先目录（只登记直接父目录会让「中间层级不含文件」的
      // 嵌套路径失去挂载点——根遍历只走不含 "/" 的键，整条子树随之丢失）
      let acc = "";
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        if (!filesByDir.has(acc)) filesByDir.set(acc, []);
        if (f.status) {
          const cur = dirStatus.get(acc) ?? null;
          if (cur === null || DIR_PRIO.indexOf(f.status) < DIR_PRIO.indexOf(cur)) dirStatus.set(acc, f.status);
        }
      }
      const parent = parts.length > 1 ? acc : "";
      if (!filesByDir.has(parent)) filesByDir.set(parent, []);
      filesByDir.get(parent)!.push(f);
    }

    const walk = (dir: string, depth: number) => {
      const s = dirStatus.get(dir) ?? null;
      const open = forceOpen || !collapsed.has(dir);
      nodes.push({ entry: { path: dir, isDir: true, status: s, touchedByAgent: false }, depth, dirStatus: s, open });
      if (!open) return;
      // 目录在前、文件在后（VSCode explorer 默认序）
      const subdirs = [...filesByDir.keys()]
        .filter((d) => d.startsWith(dir + "/") && !d.slice(dir.length + 1).includes("/"))
        .sort();
      for (const sub of subdirs) walk(sub, depth + 1);
      for (const f of (filesByDir.get(dir) ?? []).slice().sort((a, b) => a.path.localeCompare(b.path))) {
        nodes.push({ entry: f, depth: depth + 1, dirStatus: null, open: false });
      }
    };
    const roots = [...filesByDir.keys()].filter((d) => d !== "" && !d.includes("/")).sort();
    for (const r of roots) walk(r, 0);
    for (const f of (filesByDir.get("") ?? []).slice().sort((a, b) => a.path.localeCompare(b.path))) {
      nodes.push({ entry: f, depth: 0, dirStatus: null, open: false });
    }

    // 行内草稿行：新建挂目标目录节点之后（根则置顶）；重命名插在被改名节点之后原位出现
    if (draft) {
      const node: VisibleNode = {
        entry: { path: DRAFT_PATH, isDir: draft.kind === "dir", status: null, touchedByAgent: false },
        depth: 0, dirStatus: null, open: false, draft: true,
      };
      let di = -1;
      if (draft.mode === "rename" && draft.renameOf) {
        di = nodes.findIndex((n) => !n.draft && n.entry.path === draft.renameOf);
        if (di >= 0) node.depth = nodes[di].depth;
      } else if (draft.dir) {
        di = nodes.findIndex((n) => n.entry.isDir && n.entry.path === draft.dir);
        if (di >= 0) node.depth = nodes[di].depth + 1;
      }
      if (di >= 0) nodes.splice(di + 1, 0, node);
      else nodes.unshift(node);
    }
    return nodes;
  }, [files, forceOpen, collapsed, draft]);
  const nodesRef = useRef<VisibleNode[]>(visibleNodes);
  nodesRef.current = visibleNodes;

  const virtualizer = useVirtualizer({
    count: visibleNodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });

  // 激活文件揭示：展开祖先（全部模式）→ 滚动到位 → 1s 闪光
  useEffect(() => {
    const path = props.activePath;
    if (!path) return;
    setCollapsed((prev) => {
      const segs = path.split("/").slice(0, -1);
      // 已折叠的祖先才需要展开（collapsed 集合语义：在集合 = 折叠）
      if (!segs.some((s) => prev.has(s))) return prev;
      const next = new Set(prev);
      let acc = "";
      for (const s of segs) {
        acc = acc ? `${acc}/${s}` : s;
        next.delete(acc);
      }
      return next;
    });
    const raf = requestAnimationFrame(() => {
      const idx = nodesRef.current.findIndex((n) => n.entry.path === path);
      if (idx < 0) return;
      // 已在可视区则不滚动——scrollToIndex 会触发行重建，肉眼可见地闪一下
      const items = virtualizer.getVirtualItems();
      if (items.length === 0) return;
      if (idx >= items[0].index && idx <= items[items.length - 1].index) return;
      virtualizer.scrollToIndex(idx, { align: "auto" });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.activePath, props.revealTick]);

  const toggleDir = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // 行内新建：展开目标目录的全部祖先（只展开自己、祖先仍折叠时该行渲染不出来，
  // 输入行会兜底顶到树顶，看起来就像在根目录新建）→ 聚焦输入行
  const startDraft = useCallback((dir: string, kind: "file" | "dir") => {
    setDraft({ dir, kind, mode: "create" });
    setDraftName("");
    setCollapsed((prev) => {
      const segs = dir ? dir.split("/") : [];
      let acc = "";
      if (!segs.some((s) => { acc = acc ? `${acc}/${s}` : s; return prev.has(acc); })) return prev;
      const next = new Set(prev);
      acc = "";
      for (const s of segs) {
        acc = acc ? `${acc}/${s}` : s;
        next.delete(acc);
      }
      return next;
    });
  }, []);

  // 行内重命名：草稿行插在被改名节点原位，预填原名（光标全选文件主名交给 input autofocus select）
  const startRename = useCallback((path: string, isDir: boolean) => {
    setDraft({
      dir: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
      kind: isDir ? "dir" : "file",
      mode: "rename",
      renameOf: path,
    });
    setDraftName(path.split("/").pop() ?? path);
  }, []);

  // 树头新建按钮的目标目录：选中目录内 / 选中文件同级 / 根
  const selectedDir = useCallback((): string => {
    if (!selectedPath) return "";
    const n = nodesRef.current.find((x) => x.entry.path === selectedPath);
    if (!n || n.draft) return "";
    if (n.entry.isDir) return n.entry.path;
    return n.entry.path.includes("/") ? n.entry.path.slice(0, n.entry.path.lastIndexOf("/")) : "";
  }, [selectedPath]);

  const commitDraft = useCallback(async () => {
    const d = draft;
    if (!d) return;
    const name = draftName.trim();
    if (nameValidationError(name)) {
      pageSdk.toast(pageSdk.t("Files_Title"), pageSdk.t(name ? "Files_InvalidName" : "Files_NameRequired"));
      draftInputRef.current?.focus();
      return;
    }
    if (d.mode === "rename") {
      const old = d.renameOf!;
      const base = old.split("/").pop() ?? old;
      if (name === base) { setDraft(null); return; } // 名字没变：静默收场
      const ok = props.onRename ? await props.onRename(old, name, d.kind === "dir") : false;
      if (ok) setDraft(null);
      else draftInputRef.current?.focus();
      return;
    }
    if (await props.onCreate(d.dir, name, d.kind)) setDraft(null);
    else draftInputRef.current?.focus();
  }, [draft, draftName, props.onCreate, props.onRename]);

  useEffect(() => {
    if (!draft) return;
    const raf = requestAnimationFrame(() => {
      draftInputRef.current?.focus();
      // 重命名预选主名（不带扩展名）：改主名是最高频动作，扩展名默认保留
      if (draft.mode === "rename") {
        const el = draftInputRef.current;
        if (el) {
          const dot = el.value.lastIndexOf(".");
          el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
        }
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [draft]);

  const copyText = useCallback(async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* 剪贴板不可用（非安全上下文）静默 */ }
  }, []);

  const copyPath = useCallback(async (rel: string, absolute: boolean) => {
    let p = rel;
    if (absolute) {
      const repo = pageSdk.repo();
      // 原生分隔符拼接：Windows 仓库根复制出反斜杠路径（混合斜杠在资源管理器/终端里是错的）
      if (repo?.workDir) p = absPathOf(repo.workDir, rel);
    }
    void copyText(p);
  }, [copyText]);

  const openExternal = useCallback((rel: string) => {
    const repo = pageSdk.repo();
    void pageSdk.call("shell.openPath", { path: repo?.workDir ? absPathOf(repo.workDir, rel) : rel, editor: true });
  }, []);
  const reveal = useCallback((rel: string) => {
    const repo = pageSdk.repo();
    void pageSdk.call("shell.reveal", { path: repo?.workDir ? absPathOf(repo.workDir, rel) : rel });
  }, []);

  /** 树内剪贴板 → 粘贴到 toDir（剪切成功后清空剪贴板） */
  const doPaste = useCallback((c: Clip, toDir: string) => {
    if (!props.onPaste) return;
    void props.onPaste(c.path, toDir, c.cut, c.isDir).then((ok) => {
      if (ok && c.cut) setClip(null);
    });
  }, [props.onPaste]);

  /** 粘贴目标合法性：目标目录不是源自身/其子目录（拷进自己会成环） */
  const canPasteInto = useCallback((c: Clip | null, toDir: string): boolean => {
    if (!c) return false;
    if (c.path === toDir || toDir.startsWith(c.path + "/")) return false;
    if (c.cut && (c.path.includes("/") ? c.path.slice(0, c.path.lastIndexOf("/")) : "") === toDir) return false;
    return true;
  }, []);

  const menuFor = useCallback((node: VisibleNode): CtxMenuItem[] => {
    const path = node.entry.path;
    const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
    const mutators = props.onRename && props.onDelete && props.onPaste;
    if (node.entry.isDir) {
      return [
        { label: t("Files_NewFile"), icon: <NewFileIcon />, action: () => startDraft(path, "file") },
        { label: t("Files_NewFolder"), icon: <NewFolderIcon />, action: () => startDraft(path, "dir") },
        { sep: true },
        { label: t("Files_Copy"), icon: <CopyIcon />, hint: "Ctrl+C", action: () => setClip({ path, isDir: true, cut: false }) },
        { label: t("Files_Cut"), icon: <CutIcon />, hint: "Ctrl+X", action: () => setClip({ path, isDir: true, cut: true }) },
        { label: t("Files_Paste"), icon: <PasteIcon />, hint: "Ctrl+V", disabled: !canPasteInto(clip, path), action: () => { if (clip) doPaste(clip, path); } },
        { sep: true },
        ...(mutators ? [
          { label: t("Files_Rename"), icon: <PencilIcon />, hint: "F2", action: () => startRename(path, true) },
          { label: t("Files_Delete"), icon: <TrashIcon />, hint: "Del", action: () => setConfirmDel({ path, isDir: true }) },
          { sep: true },
        ] : []),
        { label: t("Files_RevealInExplorer"), icon: <RevealIcon />, action: () => reveal(path) },
        { label: t("Files_CopyPath"), icon: <CopyIcon />, action: () => void copyPath(path, true) },
      ];
    }
    const parent = parentOf(path);
    return [
      { label: t("Files_TreeOpen"), hint: "Enter", action: () => props.onOpenFile(path, { preview: false }) },
      { label: t("Files_ShowDiff"), icon: <DiffIcon />, action: () => { pageSdk.navigate("changes"); } },
      { sep: true },
      { label: t("Files_NewFile"), icon: <NewFileIcon />, action: () => startDraft(parent, "file") },
      { label: t("Files_NewFolder"), icon: <NewFolderIcon />, action: () => startDraft(parent, "dir") },
      { sep: true },
      ...(mutators ? [
        { label: t("Files_Rename"), icon: <PencilIcon />, hint: "F2", action: () => startRename(path, false) },
        { label: t("Files_Delete"), icon: <TrashIcon />, hint: "Del", action: () => setConfirmDel({ path, isDir: false }) },
        { sep: true },
      ] : []),
      { label: t("Files_Copy"), icon: <CopyIcon />, hint: "Ctrl+C", action: () => setClip({ path, isDir: false, cut: false }) },
      { label: t("Files_Cut"), icon: <CutIcon />, hint: "Ctrl+X", action: () => setClip({ path, isDir: false, cut: true }) },
      { label: t("Files_Paste"), icon: <PasteIcon />, hint: "Ctrl+V", disabled: !canPasteInto(clip, parent), action: () => { if (clip) doPaste(clip, parent); } },
      { sep: true },
      { label: t("Files_CopyName"), action: () => void copyText(path.split("/").pop() ?? path) },
      { label: t("Files_CopyPath"), icon: <CopyIcon />, action: () => void copyPath(path, true) },
      { label: t("Files_CopyRelPath"), action: () => void copyPath(path, false) },
      { sep: true },
      { label: t("Files_OpenInEditor"), icon: <OpenExternalIcon />, action: () => openExternal(path) },
      { label: t("Files_RevealInExplorer"), icon: <RevealIcon />, action: () => reveal(path) },
    ];
  }, [t, props.onOpenFile, props.onRename, props.onDelete, props.onPaste, copyPath, copyText, openExternal, reveal, startDraft, startRename, canPasteInto, clip, doPaste]);

  /** 树体空白处右键：根目录的新建 + 粘贴（行右键不冒泡到这里） */
  const bodyMenu = useCallback((): CtxMenuItem[] => [
    { label: t("Files_NewFile"), icon: <NewFileIcon />, action: () => startDraft("", "file") },
    { label: t("Files_NewFolder"), icon: <NewFolderIcon />, action: () => startDraft("", "dir") },
    { sep: true },
    { label: t("Files_Paste"), icon: <PasteIcon />, hint: "Ctrl+V", disabled: !canPasteInto(clip, ""), action: () => { if (clip) doPaste(clip, ""); } },
  ], [t, startDraft, canPasteInto, clip, doPaste]);

  const handleContext = useCallback((e: React.MouseEvent, node: VisibleNode) => {
    setKbKey(false);
    setKbFocus(node.entry.path);
    showMenu(e, menuFor(node));
  }, [showMenu, menuFor]);

  // 树体空白处右键（命中行时交给行的 onContextMenu——行在树体内，事件会冒泡）
  const handleBodyContext = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".files-row")) return;
    setKbKey(false);
    showMenu(e, bodyMenu());
  }, [showMenu, bodyMenu]);

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    const nodes = nodesRef.current;
    if (nodes.length === 0) return;
    const idx = kbFocus ? nodes.findIndex((n) => n.entry.path === kbFocus) : -1;
    const focused = idx >= 0 ? nodes[idx] : null;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setKbKey(true);
      const next = nodes[Math.max(0, Math.min(nodes.length - 1, idx < 0 ? 0 : idx + (e.key === "ArrowDown" ? 1 : -1)))];
      setKbFocus(next.entry.path);
      setSelectedPath(next.entry.path);
      virtualizer.scrollToIndex(nodes.indexOf(next), { align: "auto" });
    } else if (e.key === "Enter" && idx >= 0) {
      e.preventDefault();
      const n = nodes[idx];
      if (n.draft) { draftInputRef.current?.focus(); return; }
      if (n.entry.isDir) toggleDir(n.entry.path);
      else props.onOpenFile(n.entry.path, { preview: true });
    } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && idx >= 0) {
      const n = nodes[idx];
      if (!n.entry.isDir) return;
      const isOpen = forceOpen || !collapsed.has(n.entry.path);
      if (e.key === "ArrowRight" && !isOpen) toggleDir(n.entry.path);
      else if (e.key === "ArrowLeft" && isOpen && !forceOpen) toggleDir(n.entry.path);
    } else if (e.key === "F2" && focused && !focused.draft) {
      // F2 重命名（焦点行）
      e.preventDefault();
      startRename(focused.entry.path, focused.entry.isDir);
    } else if (e.key === "Delete" && focused && !focused.draft) {
      // Del 删除（焦点行；Modal 确认后才落盘，误触可取消）
      e.preventDefault();
      setConfirmDel({ path: focused.entry.path, isDir: focused.entry.isDir });
    } else if ((e.ctrlKey || e.metaKey) && focused && !focused.draft && (e.key === "c" || e.key === "C" || e.key === "x" || e.key === "X")) {
      // Ctrl+C/X 复制/剪切焦点行（树容器聚焦时才收到，不影响编辑器全局快捷键）
      e.preventDefault();
      setClip({ path: focused.entry.path, isDir: focused.entry.isDir, cut: e.key.toLowerCase() === "x" });
    } else if ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V") && clip) {
      // Ctrl+V 粘贴：焦点为目录 → 粘到该目录；文件 → 粘到同级；无焦点 → 根
      e.preventDefault();
      const toDir = focused
        ? (focused.entry.isDir ? focused.entry.path
          : focused.entry.path.includes("/") ? focused.entry.path.slice(0, focused.entry.path.lastIndexOf("/")) : "")
        : "";
      if (canPasteInto(clip, toDir)) doPaste(clip, toDir);
    }
  }, [kbFocus, virtualizer, toggleDir, props.onOpenFile, forceOpen, collapsed, startRename, clip, canPasteInto, doPaste]);

  // 高亮命中的 basename 子串
  const highlight = useCallback((name: string) => {
    if (!q) return name;
    const i = name.toLowerCase().indexOf(q);
    if (i < 0) return name;
    return (
      <>
        {name.slice(0, i)}
        <mark>{name.slice(i, i + q.length)}</mark>
        {name.slice(i + q.length)}
      </>
    );
  }, [q]);

  const rows = virtualizer.getVirtualItems().map((vi) => {
    const node = visibleNodes[vi.index];
    const { entry, depth } = node;
    const guides = [];
    for (let d = 0; d < depth; d++) {
      guides.push(<i key={d} className="files-guide" style={{ left: 14 + 16 * d }} />);
    }
    const rowStyle = { transform: `translateY(${vi.start}px)`, paddingLeft: 6 + depth * 16 } as const;

    // 行内新建输入行：替换文件名段，Enter 提交 / Esc 取消 / 失焦取消
    if (node.draft) {
      return (
        <div key={DRAFT_PATH} className="files-row draft" style={rowStyle}>
          {guides}
          <span className="files-fico">
            {node.entry.isDir ? <FolderIcon /> : <FileIcon path={draftName || "x"} />}
          </span>
          <input
            ref={draftInputRef}
            className="files-draft-input"
            value={draftName}
            placeholder={t("Files_NewNamePlaceholder")}
            title={draft?.dir || "/"}
            spellCheck={false}
            draggable={false}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              // 不让按键漏进树键盘导航（↑↓/Enter 会被容器截走）
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                void commitDraft();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDraft(null);
              }
            }}
            onBlur={() => setDraft(null)}
          />
        </div>
      );
    }

    // 文件行选中 = 激活标签；目录行选中 = 树内点击记忆（打开的是编辑器，文件夹需要自己的选中态）
    const isActive = entry.path === props.activePath || (entry.isDir && selectedPath === entry.path);
    const statusCls = entry.status ? STATUS_CLS[entry.status] ?? "" : "";
    const isAgent = !entry.isDir && entry.touchedByAgent;
    const nameCls =
      "files-nm" +
      (entry.isDir && node.dirStatus ? ` ${STATUS_CLS[node.dirStatus]}` : "") +
      (!entry.isDir && entry.status ? ` ${statusCls}` : "");
    return (
      <div
        key={entry.path}
        className={
          "files-row" +
          (entry.isDir && node.open ? " open" : "") +
          (isActive ? " active" : "") +
          (isAgent ? " agent" : "") +
          (kbKey && entry.path === kbFocus ? " kb-focus" : "")
        }
        style={rowStyle}
        title={entry.path}
        onClick={() => {
          setKbKey(false);
          setKbFocus(entry.path);
          setSelectedPath(entry.path);
          if (entry.isDir) {
            if (mode === "all" && !q) toggleDir(entry.path);
          } else {
            props.onOpenFile(entry.path, { preview: true });
          }
        }}
        onDoubleClick={() => { if (!entry.isDir) props.onOpenFile(entry.path, { preview: false }); }}
        onContextMenu={(e) => handleContext(e, node)}
      >
        {guides}
        <span className="files-chev">{entry.isDir ? <ChevronIcon /> : null}</span>
        <span className="files-fico">{entry.isDir ? <FolderIcon /> : <FileIcon path={entry.path} />}</span>
        <span className={nameCls}>{highlight(entry.path.split("/").pop() ?? entry.path)}</span>
        {isAgent && (
          <span className="files-spark" title={t("Files_AgentTouched")}><SparkIcon /></span>
        )}
        {!entry.isDir && entry.status && (
          <span className={`files-st ${statusCls}`}>{STATUS_LETTER[entry.status] ?? entry.status}</span>
        )}
      </div>
    );
  });

  return (
    <div className="files-pane">
      {/* 树头：标题 + 模式 tabs + 悬停动作钮 */}
      <div className="files-head">
        <div className="files-mtabs" role="tablist">
          {(["all", "git"] as FilterMode[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              title={t(m === "git" ? "Files_ModeChanges" : "Files_ModeAll")}
              className={"files-mtab" + (mode === m ? " on" : "")}
              onClick={() => {
                setMode(m);
                props.onModeChange?.(m);
              }}
            >
              {m === "all" ? <FolderIcon size={13} /> : <PencilIcon />}
              {m === "git" && <span className="n">{counts.git}</span>}
            </button>
          ))}
        </div>
        <div className="files-hacts">
          <button className="files-ibtn" title={t("Files_NewFile")} onClick={() => startDraft(selectedDir(), "file")}>
            <NewFileIcon />
          </button>
          <button className="files-ibtn" title={t("Files_NewFolder")} onClick={() => startDraft(selectedDir(), "dir")}>
            <NewFolderIcon />
          </button>
          <button
            className={"files-ibtn" + (filterOn ? " on" : "")}
            title={t("Files_FilterToggle")}
            onClick={() => {
              setFilterOn((v) => {
                const next = !v;
                if (!next) setQuery("");
                else setTimeout(() => filterInputRef.current?.focus(), 0);
                return next;
              });
            }}
          >
            <FilterIcon />
          </button>
          <button className="files-ibtn" title={t("Files_Refresh")} onClick={props.onRefresh}>
            <RefreshIcon />
          </button>
          <button
            className="files-ibtn"
            title={t("Files_CollapseAll")}
            onClick={() => setCollapsed(new Set(visibleNodes.filter((n) => n.entry.isDir && !n.draft).map((n) => n.entry.path)))}
          >
            <CollapseAllIcon />
          </button>
          <button className="files-ibtn" title={t("Files_ExpandAll")} onClick={() => setCollapsed(new Set())}>
            <ExpandAllIcon />
          </button>
        </div>
      </div>

      {/* 筛选行 */}
      {filterOn && (
        <div className="files-filter">
          <input
            ref={filterInputRef}
            type="text"
            placeholder={t("Files_SearchPlaceholder")}
            value={query}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                setFilterOn(false);
              }
            }}
          />
          {q && <span className="files-fcount">{t("Files_FilterMatches", files.length)}</span>}
          <button
            className="files-ibtn"
            style={{ width: 20, height: 20 }}
            title={t("Common_Cancel")}
            onClick={() => { setQuery(""); setFilterOn(false); }}
          >
            <CloseIcon />
          </button>
        </div>
      )}

      {/* 树体（虚拟化；键盘焦点在容器上，↑↓/Enter/←→ 导航；空白处右键 = 根目录动作） */}
      <div ref={parentRef} className="files-tree" role="tree" tabIndex={0} onKeyDown={handleKey} onContextMenu={handleBodyContext}>
        {props.loading && visibleNodes.length === 0 ? (
          <div className="files-empty">Loading…</div>
        ) : visibleNodes.length === 0 ? (
          <div className="files-empty">{t("Files_NoMatch")}</div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>{rows}</div>
        )}
      </div>
      {menuElement}

      {/* 删除确认：目录递归删除不入回收站，二次确认防误触 */}
      {confirmDel && (
        <Modal
          title={t("Files_DeleteConfirmTitle")}
          danger
          confirmText={t("Files_Delete")}
          onClose={() => setConfirmDel(null)}
          onConfirm={() => {
            const d = confirmDel;
            setConfirmDel(null);
            void props.onDelete?.(d.path, d.isDir);
          }}
        >
          <div>{t("Files_DeleteConfirmBody", confirmDel.path)}</div>
          {confirmDel.isDir && <div style={{ marginTop: 6, opacity: 0.72 }}>{t("Files_DeleteConfirmDir")}</div>}
        </Modal>
      )}
    </div>
  );
}

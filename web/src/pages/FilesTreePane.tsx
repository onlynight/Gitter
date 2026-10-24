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
 * 多选：Ctrl/Cmd 单击切换选中、Shift 单击/Shift+↑↓ 以锚点连选（可见行序）；多选态下
 * 拖拽整体移动、Ctrl+C/X 成组复制剪切、Del/右键批量删除（父目录覆盖子孙项去重）。
 * 过滤态（query / git / agent）下目录节点按文件路径祖先合成并强制全展开；
 * 「全部」模式记忆折叠状态。数据契约（TreeEntry / repo.tree）不变。
 */

export interface TreeEntry {
  path: string;
  isDir: boolean;
  /** git 状态码 (M/A/D/R/U/?/!)；null = 未改动；! = 被 .gitignore 忽略（置灰显示） */
  status: string | null;
  /** 是否被 agent 本回合碰过 */
  touchedByAgent: boolean;
  /** 目录条目：子树过大（或为链接）未随首屏枚举，点击懒加载（onExpandHeavy）后可下钻 */
  heavy?: boolean;
}

/** 行高（虚拟化定高） */
const ROW_H = 24;

/** git 状态码 → 着色类（styles.css .gs-*）与字母徽标（! = gitignore 忽略，置灰） */
const STATUS_CLS: Record<string, string> = { M: "gs-M", A: "gs-A", D: "gs-D", R: "gs-R", U: "gs-U", "?": "gs-Q", "!": "gs-IG" };
const STATUS_LETTER: Record<string, string> = { M: "M", A: "A", D: "D", R: "R", U: "U", "?": "?", "!": "!" };
/** 目录继承后代状态时的严重度优先序（U/D > M/A > R > ? > !） */
const DIR_PRIO = ["U", "D", "M", "A", "R", "?", "!"];

type FilterMode = "all" | "git";

/** 行内草稿：create = 挂 dir 下新建 kind；rename = 对 renameOf（相对根）原地改名 */
interface Draft {
  dir: string;
  kind: "file" | "dir";
  mode: "create" | "rename";
  renameOf?: string;
}

/** 树内文件剪贴板（复制/剪切暂存一组条目；粘贴成功且为剪切后清空） */
interface Clip {
  items: Array<{ path: string; isDir: boolean }>;
  cut: boolean;
}

/** 批量操作条目（多选删除/移动/复制剪切） */
type SelItem = { path: string; isDir: boolean };

/** 去掉被同批父目录覆盖的子孙项（父目录删除/移动已连带其子树） */
function topLevel(items: SelItem[]): SelItem[] {
  const sorted = [...items].sort((a, b) => a.path.length - b.path.length);
  const out: SelItem[] = [];
  for (const it of sorted) {
    if (!out.some((o) => it.path === o.path || it.path.startsWith(o.path + "/"))) out.push(it);
  }
  return out;
}

/** 单项移动/粘贴合法性：目标不是自身/自身子树；剪切回原父目录 = 无操作 */
function canMoveInto(item: SelItem, toDir: string, cut: boolean): boolean {
  if (item.path === toDir || toDir.startsWith(item.path + "/")) return false;
  const parent = item.path.includes("/") ? item.path.slice(0, item.path.lastIndexOf("/")) : "";
  if (cut && parent === toDir) return false;
  return true;
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
  /** 批量删除（目录递归、不可恢复，树内已 Modal 确认）：全部成功返回 true；失败已 toast */
  onDelete?: (items: SelItem[]) => Promise<boolean>;
  /** 批量粘贴/拖拽移动（items 逐项落到 toDir 下，cut=剪切移动）：全部成功返回 true；失败已 toast */
  onPaste?: (items: SelItem[], toDir: string, cut: boolean) => Promise<boolean>;
  /** heavy 目录（子树过大/链接）展开：按 prefix 懒加载子树并入树；成功返回 true */
  onExpandHeavy?: (path: string) => Promise<boolean>;
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
  // 树内文件剪贴板（复制/剪切一组条目；会话内有效，不与系统剪贴板互通）
  const [clip, setClip] = useState<Clip | null>(null);
  // 删除确认（目录递归且不入回收站，Modal 二次确认；多选为批量）
  const [confirmDel, setConfirmDel] = useState<{ items: SelItem[] } | null>(null);
  // 树内拖拽移动（拖起的一组行 = 源；目录行/空白区 = 放置目标，语义为剪切移动）
  const [dragItems, setDragItems] = useState<SelItem[] | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // 目录选中态（点击行记忆，供树头新建按钮定位目标目录；文件行的选中 = 激活标签）
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // 多选集合（Ctrl 切换 / Shift 锚点连选）；selectedPath 仍是主选中
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Shift 连选锚点（最近一次非 Shift 点选/键盘移动定位的行）
  const anchorRef = useRef<string | null>(null);
  // heavy 目录懒加载中（行上显示 … 徽标；期间防重复触发）
  const [expanding, setExpanding] = useState<string | null>(null);
  // 键盘导航锚点（kbFocus）+ 描边可见性（kbKey：仅键盘操作时显示描边，鼠标点击不闪边框）
  const [kbFocus, setKbFocus] = useState<string | null>(null);
  const [kbKey, setKbKey] = useState(false);
  const parentRef = useRef<HTMLDivElement | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);

  const { showMenu, menuElement } = useContextMenu();

  // 过滤：模式 + 名称筛选（筛选在 path 上匹配，命中子串在 basename 上高亮）。
  // 「变更」模式只看 git 改动（?/! 都不算——未跟踪/被忽略不是变更）
  const q = query.trim().toLowerCase();
  const files = useMemo(() => {
    let fs = props.entries.filter((e) => !e.isDir);
    if (mode === "git") fs = fs.filter((f) => f.status !== null && f.status !== "!");
    if (q) fs = fs.filter((f) => f.path.toLowerCase().includes(q));
    return fs;
  }, [props.entries, mode, q]);
  const forceOpen = mode !== "all" || q !== "";
  // 真实目录条目（后端下发，含空目录与 heavy 折叠目录）——仅「全部」视图并入树
  const dirEntries = useMemo(() => props.entries.filter((e) => e.isDir), [props.entries]);
  const counts = useMemo(() => ({
    git: props.entries.filter((e) => !e.isDir && e.status !== null && e.status !== "!").length,
  }), [props.entries]);

  // 扁平化可见节点（目录 = 文件路径全部祖先合成；目录状态色按严重度继承）。
  // 「全部」视图额外并入后端下发的真实目录条目——空目录不在任何文件路径的
  // 祖先链上，只能由此显示；过滤视图（git/query）仍由可见文件反推目录。
  const visibleNodes = useMemo<VisibleNode[]>(() => {
    const nodes: VisibleNode[] = [];
    const dirStatus = new Map<string, string | null>();
    const filesByDir = new Map<string, TreeEntry[]>();
    const realDir = new Map<string, TreeEntry>();
    /** 按严重度继承写入目录状态色（后者的优先序见 DIR_PRIO） */
    const inherit = (dir: string, status: string | null) => {
      if (!status) return;
      const cur = dirStatus.get(dir) ?? null;
      if (cur === null || DIR_PRIO.indexOf(status) < DIR_PRIO.indexOf(cur)) dirStatus.set(dir, status);
    };
    if (!forceOpen) {
      for (const d of dirEntries) {
        const parts = d.path.split("/");
        let acc = "";
        for (let i = 0; i < parts.length - 1; i++) {
          acc = acc ? `${acc}/${parts[i]}` : parts[i];
          if (!filesByDir.has(acc)) filesByDir.set(acc, []);
          inherit(acc, d.status);
        }
        if (!filesByDir.has(d.path)) filesByDir.set(d.path, []);
        inherit(d.path, d.status);
        realDir.set(d.path, d);
      }
    }
    for (const f of files) {
      const parts = f.path.split("/");
      // 逐层登记全部祖先目录（只登记直接父目录会让「中间层级不含文件」的
      // 嵌套路径失去挂载点——根遍历只走不含 "/" 的键，整条子树随之丢失）
      let acc = "";
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        if (!filesByDir.has(acc)) filesByDir.set(acc, []);
        if (f.status) inherit(acc, f.status);
      }
      const parent = parts.length > 1 ? acc : "";
      if (!filesByDir.has(parent)) filesByDir.set(parent, []);
      filesByDir.get(parent)!.push(f);
    }

    const walk = (dir: string, depth: number) => {
      const s = dirStatus.get(dir) ?? null;
      const open = forceOpen || !collapsed.has(dir);
      const real = realDir.get(dir);
      nodes.push({
        entry: real ? { ...real, status: s } : { path: dir, isDir: true, status: s, touchedByAgent: false },
        depth, dirStatus: s, open,
      });
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
  }, [files, dirEntries, forceOpen, collapsed, draft]);
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

  // heavy 目录展开 = 按目录懒加载子树（onExpandHeavy 并树）。加载后保持折叠：
  // 超大目录（node_modules 类）自动展开会整屏倾泻内容；子树已就位且后端已登记
  // （整树刷新不回退 heavy），用户再次点击/Enter 即秒开
  const expandHeavyRow = useCallback(async (path: string) => {
    if (!props.onExpandHeavy || expanding) return;
    setExpanding(path);
    const ok = await props.onExpandHeavy(path).catch(() => false);
    setExpanding(null);
    if (ok) {
      setCollapsed((prev) => {
        if (prev.has(path)) return prev;
        const next = new Set(prev);
        next.add(path);
        return next;
      });
    }
  }, [props.onExpandHeavy, expanding]);

  // ---- 多选（Ctrl 切换 / Shift 锚点连选；selectedPath 保持主选中语义）----

  /** 单选（清空多选），锚点同步重置 */
  const selectSingle = useCallback((path: string) => {
    anchorRef.current = path;
    setSelected(new Set([path]));
    setSelectedPath(path);
  }, []);

  /** Shift 连选：从锚点到 path 的可见行区间（锚点已失效则退化为单选） */
  const selectRangeTo = useCallback((path: string) => {
    const nodes = nodesRef.current.filter((n) => !n.draft);
    const to = nodes.findIndex((n) => n.entry.path === path);
    if (to < 0) return;
    const from = anchorRef.current ? nodes.findIndex((n) => n.entry.path === anchorRef.current) : -1;
    if (from < 0) { selectSingle(path); return; }
    const [a, b] = from <= to ? [from, to] : [to, from];
    const next = new Set<string>();
    for (let i = a; i <= b; i++) next.add(nodes[i].entry.path);
    setSelected(next);
    setSelectedPath(path);
  }, [selectSingle]);

  /** Ctrl/Cmd 单击切换该项选中；主选中与锚点随点击走 */
  const selectToggle = useCallback((path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    anchorRef.current = path;
    setSelectedPath(path);
  }, []);

  /** 多选集 → 批量条目：选中集（可见部分）非空 = 整组生效——对齐资源管理器，焦点行
   *  即使被 Ctrl 点出选中集，Del/Ctrl+X·C 仍按选中集算；选中集为空才回落到焦点行 */
  const selectionEntries = useCallback((focused?: VisibleNode | null): SelItem[] => {
    if (selected.size > 0) {
      const visible = topLevel(nodesRef.current
        .filter((n) => !n.draft && selected.has(n.entry.path))
        .map((n) => ({ path: n.entry.path, isDir: n.entry.isDir })));
      if (visible.length > 0) return visible;
    }
    return focused ? [{ path: focused.entry.path, isDir: focused.entry.isDir }] : [];
  }, [selected]);

  // 树刷新后选中集随条目存在性修剪（删除/外部变更移除的路径不再保留）
  useEffect(() => {
    if (selected.size === 0 && !selectedPath) return;
    const exist = new Set(props.entries.map((e) => e.path));
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set([...prev].filter((p) => exist.has(p)));
      return next.size === prev.size ? prev : next;
    });
    setSelectedPath((p) => (p && exist.has(p) ? p : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.entries]);

  // 默认折叠：所有目录（含后来新出现的——heavy 懒加载并入的子树、外部新建的目录）
  // 收拢为顶层级可见，点开即展开。已知目录不重复处理（保留用户手动展开/折叠），
  // 只对首次登记的目录补折叠；首装时活动文件的祖先豁免（任务页跳转/会话恢复
  // 不被折叠遮住），豁免同样记为已知（此后刷新不再重复折叠）。仓库切换经
  // FilesPage 的 key 重挂重置。
  const knownDirsRef = useRef<Set<string>>(new Set());
  const collapseInitRef = useRef(false);
  useEffect(() => {
    if (props.entries.length === 0) return;
    const dirs = new Set<string>();
    for (const e of props.entries) {
      // 目录条目自身也要折叠（空目录不在任何文件路径的祖先链上）
      if (e.isDir) dirs.add(e.path);
      const parts = e.path.split("/");
      let acc = "";
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        dirs.add(acc);
      }
    }
    const exempt = new Set<string>();
    if (!collapseInitRef.current) {
      collapseInitRef.current = true;
      const segs = (props.activePath ?? "").split("/");
      let acc = "";
      for (let i = 0; i < segs.length - 1; i++) {
        acc = acc ? `${acc}/${segs[i]}` : segs[i];
        exempt.add(acc);
      }
    }
    const known = knownDirsRef.current;
    const fresh = [...dirs].filter((d) => !known.has(d) && !exempt.has(d));
    for (const d of dirs) known.add(d);
    if (fresh.length === 0) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      for (const d of fresh) next.add(d);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.entries]);

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

  /** 树内剪贴板 → 粘贴到 toDir（批量逐项校验；剪切成功后清空剪贴板） */
  const doPaste = useCallback((c: Clip, toDir: string) => {
    if (!props.onPaste) return;
    const items = topLevel(c.items).filter((it) => canMoveInto(it, toDir, c.cut));
    if (items.length === 0) return;
    void props.onPaste(items, toDir, c.cut).then((ok) => {
      if (ok && c.cut) setClip(null);
    });
  }, [props.onPaste]);

  /** 粘贴目标合法性：至少一项可移动（目标不是源自身/其子目录，剪切不回原父目录） */
  const canPasteInto = useCallback((c: Clip | null, toDir: string): boolean => {
    if (!c) return false;
    return topLevel(c.items).some((it) => canMoveInto(it, toDir, c.cut));
  }, []);

  /** 拖拽放置 = 批量剪切移动到 toDir（合法性同粘贴门控；完成/取消后清拖拽态） */
  const dropMove = useCallback((toDir: string) => {
    const items = dragItems;
    setDragItems(null);
    setDropTarget(null);
    if (!items || items.length === 0 || !props.onPaste) return;
    const movable = topLevel(items).filter((it) => canMoveInto(it, toDir, true));
    if (movable.length === 0) return;
    void props.onPaste(movable, toDir, true);
  }, [dragItems, props.onPaste]);

  const menuFor = useCallback((node: VisibleNode): CtxMenuItem[] => {
    const path = node.entry.path;
    const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
    const mutators = props.onRename && props.onDelete && props.onPaste;
    // 多选右键（命中项在多选集内且不止一项）：成组剪切/复制/删除——单项目标动作（打开/重命名等）不适用
    if (selected.has(path) && selected.size > 1) {
      const items = selectionEntries(node);
      return [
        { label: t("Files_Cut"), icon: <CutIcon />, hint: "Ctrl+X", action: () => setClip({ items, cut: true }) },
        { label: t("Files_Copy"), icon: <CopyIcon />, hint: "Ctrl+C", action: () => setClip({ items, cut: false }) },
        { sep: true },
        ...(props.onDelete ? [
          { label: t("Files_Delete"), icon: <TrashIcon />, hint: "Del", action: () => setConfirmDel({ items }) },
        ] : []),
      ];
    }
    if (node.entry.isDir) {
      return [
        { label: t("Files_NewFile"), icon: <NewFileIcon />, action: () => startDraft(path, "file") },
        { label: t("Files_NewFolder"), icon: <NewFolderIcon />, action: () => startDraft(path, "dir") },
        { sep: true },
        { label: t("Files_Copy"), icon: <CopyIcon />, hint: "Ctrl+C", action: () => setClip({ items: [{ path, isDir: true }], cut: false }) },
        { label: t("Files_Cut"), icon: <CutIcon />, hint: "Ctrl+X", action: () => setClip({ items: [{ path, isDir: true }], cut: true }) },
        { label: t("Files_Paste"), icon: <PasteIcon />, hint: "Ctrl+V", disabled: !canPasteInto(clip, path), action: () => { if (clip) doPaste(clip, path); } },
        { sep: true },
        ...(mutators ? [
          { label: t("Files_Rename"), icon: <PencilIcon />, hint: "F2", action: () => startRename(path, true) },
          { label: t("Files_Delete"), icon: <TrashIcon />, hint: "Del", action: () => setConfirmDel({ items: [{ path, isDir: true }] }) },
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
        { label: t("Files_Delete"), icon: <TrashIcon />, hint: "Del", action: () => setConfirmDel({ items: [{ path, isDir: false }] }) },
        { sep: true },
      ] : []),
      { label: t("Files_Copy"), icon: <CopyIcon />, hint: "Ctrl+C", action: () => setClip({ items: [{ path, isDir: false }], cut: false }) },
      { label: t("Files_Cut"), icon: <CutIcon />, hint: "Ctrl+X", action: () => setClip({ items: [{ path, isDir: false }], cut: true }) },
      { label: t("Files_Paste"), icon: <PasteIcon />, hint: "Ctrl+V", disabled: !canPasteInto(clip, parent), action: () => { if (clip) doPaste(clip, parent); } },
      { sep: true },
      { label: t("Files_CopyName"), action: () => void copyText(path.split("/").pop() ?? path) },
      { label: t("Files_CopyPath"), icon: <CopyIcon />, action: () => void copyPath(path, true) },
      { label: t("Files_CopyRelPath"), action: () => void copyPath(path, false) },
      { sep: true },
      { label: t("Files_OpenInEditor"), icon: <OpenExternalIcon />, action: () => openExternal(path) },
      { label: t("Files_RevealInExplorer"), icon: <RevealIcon />, action: () => reveal(path) },
    ];
  }, [t, props.onOpenFile, props.onDelete, props.onRename, props.onPaste, copyPath, copyText, openExternal, reveal, startDraft, startRename, canPasteInto, clip, doPaste, selected, selectionEntries]);

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
    // 右键未命中多选集 = 重置为该项单选（命中则保留整组，菜单按多选出）
    if (!selected.has(node.entry.path)) selectSingle(node.entry.path);
    showMenu(e, menuFor(node));
  }, [showMenu, menuFor, selected, selectSingle]);

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
      // Shift+↑↓ 以锚点扩选；普通移动重置为单选（草稿输入行不进选中集）
      if (next.draft) { setSelected(new Set()); setSelectedPath(null); }
      else if (e.shiftKey) selectRangeTo(next.entry.path);
      else selectSingle(next.entry.path);
      virtualizer.scrollToIndex(nodes.indexOf(next), { align: "auto" });
    } else if (e.key === "Enter" && idx >= 0) {
      e.preventDefault();
      const n = nodes[idx];
      if (n.draft) { draftInputRef.current?.focus(); return; }
      if (n.entry.isDir) {
        if (n.entry.heavy) void expandHeavyRow(n.entry.path);
        else toggleDir(n.entry.path);
      } else {
        props.onOpenFile(n.entry.path, { preview: true });
      }
    } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && idx >= 0) {
      const n = nodes[idx];
      if (!n.entry.isDir || n.entry.heavy) return;
      const isOpen = forceOpen || !collapsed.has(n.entry.path);
      if (e.key === "ArrowRight" && !isOpen) toggleDir(n.entry.path);
      else if (e.key === "ArrowLeft" && isOpen && !forceOpen) toggleDir(n.entry.path);
    } else if (e.key === "F2" && focused && !focused.draft) {
      // F2 重命名（焦点行）
      e.preventDefault();
      startRename(focused.entry.path, focused.entry.isDir);
    } else if (e.key === "Delete" && focused && !focused.draft) {
      // Del 删除（焦点行在多选内 = 整组；Modal 确认后才落盘，误触可取消）
      e.preventDefault();
      setConfirmDel({ items: selectionEntries(focused) });
    } else if ((e.ctrlKey || e.metaKey) && focused && !focused.draft && (e.key === "c" || e.key === "C" || e.key === "x" || e.key === "X")) {
      // Ctrl+C/X 复制/剪切（焦点行在多选内 = 整组；树容器聚焦时才收到，不影响编辑器全局快捷键）
      e.preventDefault();
      setClip({ items: selectionEntries(focused), cut: e.key.toLowerCase() === "x" });
    } else if ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V") && clip) {
      // Ctrl+V 粘贴：焦点为目录 → 粘到该目录；文件 → 粘到同级；无焦点 → 根
      e.preventDefault();
      const toDir = focused
        ? (focused.entry.isDir ? focused.entry.path
          : focused.entry.path.includes("/") ? focused.entry.path.slice(0, focused.entry.path.lastIndexOf("/")) : "")
        : "";
      if (canPasteInto(clip, toDir)) doPaste(clip, toDir);
    }
  }, [kbFocus, virtualizer, toggleDir, expandHeavyRow, props.onOpenFile, forceOpen, collapsed, startRename, clip, canPasteInto, doPaste, selectRangeTo, selectSingle, selectionEntries]);

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
    const isSelected = selected.has(entry.path);
    const statusCls = entry.status ? STATUS_CLS[entry.status] ?? "" : "";
    const isAgent = !entry.isDir && entry.touchedByAgent;
    const nameCls =
      "files-nm" +
      (entry.isDir && node.dirStatus ? ` ${STATUS_CLS[node.dirStatus]}` : "") +
      (!entry.isDir && entry.status ? ` ${statusCls}` : "");
    const isDropDir = entry.isDir && dropTarget === entry.path;
    return (
      <div
        key={entry.path}
        className={
          "files-row" +
          (entry.isDir && node.open ? " open" : "") +
          (entry.heavy ? " heavy" : "") +
          (isActive ? " active" : "") +
          (isSelected ? " selected" : "") +
          (isAgent ? " agent" : "") +
          (kbKey && entry.path === kbFocus ? " kb-focus" : "") +
          (isDropDir ? " drop-target" : "") +
          (dragItems?.some((i) => i.path === entry.path) ? " dragging" : "")
        }
        style={rowStyle}
        title={entry.heavy ? t("Files_HeavyDir") : entry.path}
        draggable
        onDragStart={(e) => {
          // 拖起项：行在多选内 = 整组随拖；否则重置为该行单选
          const items = selected.has(entry.path) && selected.size > 1
            ? selectionEntries()
            : [{ path: entry.path, isDir: entry.isDir }];
          if (!selected.has(entry.path)) selectSingle(entry.path);
          e.dataTransfer.setData("text/gitter-tree", items.map((i) => i.path).join("\n"));
          e.dataTransfer.effectAllowed = "move";
          setDragItems(items);
        }}
        onDragEnd={() => { setDragItems(null); setDropTarget(null); }}
        onDragOver={(e) => {
          if (!entry.isDir || !dragItems) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (dropTarget !== entry.path) setDropTarget(entry.path);
        }}
        onDragLeave={(e) => {
          if (entry.isDir && dropTarget === entry.path) setDropTarget(null);
          void e;
        }}
        onDrop={(e) => {
          if (!entry.isDir) return;
          e.preventDefault();
          e.stopPropagation();
          dropMove(entry.path);
        }}
        onClick={(e) => {
          setKbKey(false);
          setKbFocus(entry.path);
          // Ctrl/Cmd 切换选中、Shift 以锚点连选——均不切换目录、不打开文件
          if (e.shiftKey) { selectRangeTo(entry.path); return; }
          if (e.ctrlKey || e.metaKey) { selectToggle(entry.path); return; }
          selectSingle(entry.path);
          if (entry.isDir) {
            // heavy 目录点击 = 懒加载子树（加载完自动展开）
            if (entry.heavy) void expandHeavyRow(entry.path);
            else if (mode === "all" && !q) toggleDir(entry.path);
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
        {expanding === entry.path && <span className="files-st">…</span>}
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
          <button className="files-ibtn" title={t("Files_ExpandAll")} onClick={() => setCollapsed(new Set())}>
            <ExpandAllIcon />
          </button>
          <button
            className="files-ibtn"
            title={t("Files_CollapseAll")}
            onClick={() => setCollapsed(new Set(visibleNodes.filter((n) => n.entry.isDir && !n.draft).map((n) => n.entry.path)))}
          >
            <CollapseAllIcon />
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

      {/* 树体（虚拟化；键盘焦点在容器上，↑↓/Enter/←→ 导航；空白处右键 = 根目录动作，
          空白处拖放 = 移动到根目录） */}
      <div
        ref={parentRef}
        className="files-tree"
        role="tree"
        tabIndex={0}
        onKeyDown={handleKey}
        onContextMenu={handleBodyContext}
        onDragOver={(e) => {
          if (!dragItems) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => {
          // 命中行时行的 onDrop 已处理（行会 stopPropagation）；到这里 = 空白区 → 根
          if (!dragItems) return;
          e.preventDefault();
          dropMove("");
        }}
        onDragEnd={() => { setDragItems(null); setDropTarget(null); }}
      >
        {props.loading && visibleNodes.length === 0 ? (
          <div className="files-empty">Loading…</div>
        ) : visibleNodes.length === 0 ? (
          <div className="files-empty">{t("Files_NoMatch")}</div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>{rows}</div>
        )}
      </div>
      {menuElement}

      {/* 删除确认：目录递归删除不入回收站，二次确认防误触；多选列出明细 */}
      {confirmDel && (
        <Modal
          title={confirmDel.items.length > 1 ? t("Files_DeleteManyConfirmTitle") : t("Files_DeleteConfirmTitle")}
          danger
          confirmText={t("Files_Delete")}
          onClose={() => setConfirmDel(null)}
          onConfirm={() => {
            const d = confirmDel;
            setConfirmDel(null);
            void props.onDelete?.(d.items);
          }}
        >
          {confirmDel.items.length > 1 ? (
            <>
              <div>{t("Files_DeleteManyConfirmBody", confirmDel.items.length)}</div>
              <div style={{ marginTop: 6, opacity: 0.72, maxHeight: 132, overflow: "auto" }}>
                {confirmDel.items.slice(0, 8).map((it) => (
                  <div key={it.path}>{it.path}</div>
                ))}
                {confirmDel.items.length > 8 && <div>…</div>}
              </div>
              {confirmDel.items.some((it) => it.isDir) && (
                <div style={{ marginTop: 6, opacity: 0.72 }}>{t("Files_DeleteConfirmDir")}</div>
              )}
            </>
          ) : (
            <>
              <div>{t("Files_DeleteConfirmBody", confirmDel.items[0].path)}</div>
              {confirmDel.items[0].isDir && <div style={{ marginTop: 6, opacity: 0.72 }}>{t("Files_DeleteConfirmDir")}</div>}
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

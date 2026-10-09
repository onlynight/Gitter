import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useContextMenu, type CtxMenuItem } from "../kit";
import { pageSdk } from "../pageSdk";
import { ChevronIcon, CloseIcon, CollapseAllIcon, CopyIcon, DiffIcon, FileIcon, FilterIcon, FolderIcon, OpenExternalIcon, PencilIcon, RefreshIcon, RevealIcon, SparkIcon } from "./filesIcons";

/**
 * 文件树组件（files-editor-redesign-mockup.html §二/§三，P2）：
 * 树头（标题 + 变更/回合/全部模式 tabs + 悬停动作钮）+ 筛选行 + 虚拟化树体。
 * 行：24px 无行线 + 缩进参考线 + chevron 旋转 + 类型着色图标 + git 状态着色/字母徽标
 * + agent 回合左缘紫 bar + ✦ 徽标；键盘 ↑↓/Enter/←→；右键菜单带图标与键位提示。
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

interface VisibleNode {
  entry: TreeEntry;
  depth: number;
  /** 目录节点合成时继承的状态色（null = 中性） */
  dirStatus: string | null;
  open: boolean;
}

export function TreePane(props: {
  entries: TreeEntry[];
  activePath: string | null;
  onOpenFile: (path: string, opts?: { preview?: boolean }) => void;
  loading: boolean;
  onRefresh: () => void;
  /** 面包屑点击等场景的「重新揭示当前文件」信号（activePath 不变也要滚动+闪光） */
  revealTick?: number;
}) {
  const t = pageSdk.t;
  const [mode, setMode] = useState<FilterMode>("all");
  const [filterOn, setFilterOn] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
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

  // 扁平化可见节点（目录 = 显式目录 ∪ 文件路径祖先合成；目录状态色按严重度继承）
  const visibleNodes = useMemo<VisibleNode[]>(() => {
    const nodes: VisibleNode[] = [];
    const dirStatus = new Map<string, string | null>();
    const filesByDir = new Map<string, TreeEntry[]>();
    for (const f of files) {
      const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
      if (!filesByDir.has(dir)) filesByDir.set(dir, []);
      filesByDir.get(dir)!.push(f);
    }
    for (const [dir, list] of filesByDir) {
      let s: string | null = null;
      for (const f of list) {
        if (!f.status) continue;
        if (s === null || DIR_PRIO.indexOf(f.status) < DIR_PRIO.indexOf(s)) s = f.status;
      }
      dirStatus.set(dir, s);
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
    return nodes;
  }, [files, forceOpen, collapsed]);
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

  const copyPath = useCallback(async (rel: string, absolute: boolean) => {
    let p = rel;
    if (absolute) {
      const repo = pageSdk.repo();
      if (repo?.workDir) p = `${repo.workDir.replace(/[\\/]+$/, "")}/${rel}`;
    }
    try { await navigator.clipboard.writeText(p); } catch { /* 剪贴板不可用（非安全上下文）静默 */ }
  }, []);

  const openExternal = useCallback((rel: string) => {
    void pageSdk.call("shell.openPath", { path: rel, editor: true });
  }, []);
  const reveal = useCallback((rel: string) => {
    void pageSdk.call("shell.reveal", { path: rel });
  }, []);

  const menuFor = useCallback((node: VisibleNode): CtxMenuItem[] => {
    const path = node.entry.path;
    if (node.entry.isDir) {
      return [
        { label: t("Files_RevealInExplorer"), icon: <RevealIcon />, action: () => reveal(path) },
        { label: t("Files_CopyPath"), icon: <CopyIcon />, action: () => void copyPath(path, true) },
      ];
    }
    return [
      { label: t("Files_TreeOpen"), hint: "Enter", action: () => props.onOpenFile(path, { preview: false }) },
      { label: t("Files_ShowDiff"), icon: <DiffIcon />, action: () => { pageSdk.navigate("changes"); } },
      { sep: true },
      { label: t("Files_CopyPath"), icon: <CopyIcon />, action: () => void copyPath(path, true) },
      { label: t("Files_CopyRelPath"), action: () => void copyPath(path, false) },
      { sep: true },
      { label: t("Files_OpenInEditor"), icon: <OpenExternalIcon />, action: () => openExternal(path) },
      { label: t("Files_RevealInExplorer"), icon: <RevealIcon />, action: () => reveal(path) },
    ];
  }, [t, props.onOpenFile, copyPath, openExternal, reveal]);

  const handleContext = useCallback((e: React.MouseEvent, node: VisibleNode) => {
    setKbKey(false);
    setKbFocus(node.entry.path);
    showMenu(e, menuFor(node));
  }, [showMenu, menuFor]);

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    const nodes = nodesRef.current;
    if (nodes.length === 0) return;
    const idx = kbFocus ? nodes.findIndex((n) => n.entry.path === kbFocus) : -1;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setKbKey(true);
      const next = nodes[Math.max(0, Math.min(nodes.length - 1, idx < 0 ? 0 : idx + (e.key === "ArrowDown" ? 1 : -1)))];
      setKbFocus(next.entry.path);
      virtualizer.scrollToIndex(nodes.indexOf(next), { align: "auto" });
    } else if (e.key === "Enter" && idx >= 0) {
      e.preventDefault();
      const n = nodes[idx];
      if (n.entry.isDir) toggleDir(n.entry.path);
      else props.onOpenFile(n.entry.path, { preview: true });
    } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && idx >= 0) {
      const n = nodes[idx];
      if (!n.entry.isDir) return;
      const isOpen = forceOpen || !collapsed.has(n.entry.path);
      if (e.key === "ArrowRight" && !isOpen) toggleDir(n.entry.path);
      else if (e.key === "ArrowLeft" && isOpen && !forceOpen) toggleDir(n.entry.path);
    }
  }, [kbFocus, virtualizer, toggleDir, props.onOpenFile, forceOpen, collapsed]);

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
    const isActive = entry.path === props.activePath;
    const statusCls = entry.status ? STATUS_CLS[entry.status] ?? "" : "";
    const isAgent = !entry.isDir && entry.touchedByAgent;
    const nameCls =
      "files-nm" +
      (entry.isDir && node.dirStatus ? ` ${STATUS_CLS[node.dirStatus]}` : "") +
      (!entry.isDir && entry.status ? ` ${statusCls}` : "");
    const guides = [];
    for (let d = 0; d < depth; d++) {
      guides.push(<i key={d} className="files-guide" style={{ left: 14 + 16 * d }} />);
    }
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
        style={{ transform: `translateY(${vi.start}px)`, paddingLeft: 6 + depth * 16 }}
        title={entry.path}
        onClick={() => {
          setKbKey(false);
          setKbFocus(entry.path);
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
              onClick={() => setMode(m)}
            >
              {m === "all" ? <FolderIcon size={13} /> : <PencilIcon />}
              {m === "git" && <span className="n">{counts.git}</span>}
            </button>
          ))}
        </div>
        <div className="files-hacts">
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
            onClick={() => setCollapsed(new Set(visibleNodes.filter((n) => n.entry.isDir).map((n) => n.entry.path)))}
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

      {/* 树体（虚拟化；键盘焦点在容器上，↑↓/Enter/←→ 导航） */}
      <div ref={parentRef} className="files-tree" role="tree" tabIndex={0} onKeyDown={handleKey}>
        {props.loading && visibleNodes.length === 0 ? (
          <div className="files-empty">Loading…</div>
        ) : visibleNodes.length === 0 ? (
          <div className="files-empty">{t("Files_NoMatch")}</div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>{rows}</div>
        )}
      </div>
      {menuElement}
    </div>
  );
}

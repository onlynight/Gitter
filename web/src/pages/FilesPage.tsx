import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pageSdk } from "../pageSdk";
import { TreePane, type TreeEntry } from "./FilesTreePane";
import { EditorPane, type EditorTab } from "./FilesEditorPane";
import { QuickOpen } from "./FilesQuickOpen";

/**
 * 项目文件树页面（files-editor-redesign-mockup.html）：
 * 左侧资源管理器树（git 状态/agent 回合高亮 + 模式 tabs + 筛选）+ 右侧编辑器
 * （chip 标签 + 面包屑 + Monaco + 页脚状态条）。
 * 分栏为定宽 px（170–520，localStorage 持久化，双击复位，Ctrl+B 整体收起）。
 * 走页面包链路（manifest → pageLoader → registerPage → PageOutlet keep-alive）。
 */

const SIDEBAR_KEY = "gitter.files.sidebar.v2";
const SIDEBAR_DEFAULT = 248;
const SIDEBAR_MIN = 170;
const SIDEBAR_MAX = 520;

function loadWidth(): number {
  const raw = window.localStorage.getItem(SIDEBAR_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n)) : SIDEBAR_DEFAULT;
}

export function FilesPage() {
  const [treeData, setTreeData] = useState<{ entries: TreeEntry[]; hasMore: boolean }>({ entries: [], hasMore: false });
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [width, setWidth] = useState(loadWidth);
  const [collapsed, setCollapsed] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [revealTick, setRevealTick] = useState(0);

  const repo = pageSdk.repo();
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const quickOpenRef = useRef(quickOpen);
  quickOpenRef.current = quickOpen;

  // 加载文件树
  const loadTree = useCallback(async () => {
    if (!repo) return;
    setLoading(true);
    try {
      const r = await pageSdk.call<{ entries: TreeEntry[]; hasMore: boolean }>("repo.tree", {
        prefix: "",
        taskId: null,
      });
      setTreeData({ entries: r.entries ?? [], hasMore: r.hasMore ?? false });
    } catch (e) {
      pageSdk.toast(pageSdk.t("Files_Title"), (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [repo]);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  // 打开文件：单击 = 预览标签（唯一，再开即替换）；再次打开/显式 pin = 转正
  const openFile = useCallback((path: string, opts?: { preview?: boolean }) => {
    const preview = opts?.preview !== false;
    setTabs((prev) => {
      const i = prev.findIndex((x) => x.path === path);
      if (i >= 0) {
        if (!preview && prev[i].preview) {
          const n = prev.slice();
          n[i] = { path, preview: false };
          return n;
        }
        return prev;
      }
      const base = preview ? prev.filter((x) => !x.preview) : prev;
      return [...base, { path, preview }];
    });
    setActiveTab(path);
  }, []);
  // 标签点击/双击 = 转正并激活
  const activateTab = useCallback((path: string) => openFile(path, { preview: false }), [openFile]);

  // 关闭标签（EditorPane 确认无未保存更改后回调）：激活位顺移邻位
  const closeTab = useCallback((path: string) => {
    const i = tabsRef.current.findIndex((x) => x.path === path);
    if (i < 0) return;
    const next = tabsRef.current.filter((x) => x.path !== path);
    setTabs(next);
    setActiveTab((a) => (a === path ? (next[Math.min(i, next.length - 1)]?.path ?? null) : a));
  }, []);

  // path → git 状态码（标签名着色 + 页脚徽标）
  const statusByPath = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const e of treeData.entries) {
      if (!e.isDir) map[e.path] = e.status;
    }
    return map;
  }, [treeData.entries]);

  const allFiles = useMemo(() => treeData.entries.filter((e) => !e.isDir).map((e) => e.path), [treeData.entries]);

  // 全局快捷键：Ctrl+P 快速打开；Ctrl+B 收起/展开文件树
  // （须排除 Shift/Alt：Ctrl+Shift+P 是宿主命令面板，不能重复触发）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "p") {
        e.preventDefault();
        setQuickOpen((v) => !v);
      } else if (k === "b") {
        e.preventDefault();
        setCollapsed((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // 分栏拖拽（定宽 px；双击复位）
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const onGutterDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startW: width };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    (e.target as HTMLElement).classList.add("drag");
    document.body.style.userSelect = "none";
    e.preventDefault();
  }, [width]);
  const onGutterMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, d.startW + e.clientX - d.startX)));
  }, []);
  const onGutterUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    (e.target as HTMLElement).classList.remove("drag");
    document.body.style.userSelect = "";
    setWidth((w) => {
      window.localStorage.setItem(SIDEBAR_KEY, String(w));
      return w;
    });
  }, []);

  // 空仓库提示
  if (!repo) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
        <div style={{ textAlign: "center", opacity: 0.7 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
          <div>{pageSdk.t("Files_Empty")}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="files-split">
      {!collapsed && (
        <div className="files-side" style={{ width, flex: "none" }}>
          <TreePane
            entries={treeData.entries}
            activePath={activeTab}
            onOpenFile={openFile}
            loading={loading}
            onRefresh={() => void loadTree()}
            revealTick={revealTick}
          />
        </div>
      )}
      {/* 分割线拖拽条常驻（树收起时充当编辑区左缘分割线） */}
      <div
        className="files-gutter"
        title={pageSdk.t("Files_GutterHint")}
        onPointerDown={onGutterDown}
        onPointerMove={onGutterMove}
        onPointerUp={onGutterUp}
        onLostPointerCapture={onGutterUp}
        onDoubleClick={() => {
          setWidth(SIDEBAR_DEFAULT);
          window.localStorage.setItem(SIDEBAR_KEY, String(SIDEBAR_DEFAULT));
        }}
      />
      <div className="files-main">
        <EditorPane
          tabs={tabs}
          activeTab={activeTab}
          statusByPath={statusByPath}
          onActivateTab={activateTab}
          onPinTab={activateTab}
          onCloseTab={closeTab}
          onQuickOpen={() => setQuickOpen(true)}
          onToggleSidebar={() => setCollapsed(false)}
          onReveal={() => setRevealTick((v) => v + 1)}
          onSaved={() => void loadTree()}
        />
        {quickOpen && (
          <QuickOpen
            files={allFiles}
            onOpen={(p) => openFile(p, { preview: true })}
            onClose={() => setQuickOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

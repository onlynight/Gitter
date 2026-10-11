import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pageSdk, useAppState } from "../pageSdk";
import { TreePane, type TreeEntry } from "./FilesTreePane";
import { EditorPane, type EditorPaneHandle, type EditorTab } from "./FilesEditorPane";
import { QuickOpen } from "./FilesQuickOpen";
import { GlobalSearch } from "./FilesGlobalSearch";
import { relOfWork } from "./filesPaths";

/**
 * 项目文件树页面（files-editor-redesign-mockup.html）：
 * 左侧资源管理器树（git 状态/agent 回合高亮 + 模式 tabs + 筛选 + 拖拽移动）+ 右侧编辑器
 * （chip 标签（拖拽排序/固定/分屏）+ 面包屑 + Monaco + 问题面板 + 页脚状态条）。
 * 全局搜索 Ctrl+Shift+F；外部文件变更经 fs.changed 事件刷树并校验打开标签。
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
  // 文件树模式（全部/变更）：变更模式下编辑器才显示 git 行级 diff 高亮
  const [treeMode, setTreeMode] = useState<"all" | "git">("all");
  // 全局搜索（Ctrl+Shift+F）+ 搜索结果定位 + 外部变更信号（驱动编辑器 mtime 校验）
  const [globalSearch, setGlobalSearch] = useState(false);
  const [reveal, setReveal] = useState<{ path: string; line: number; ts: number } | null>(null);
  const [fsTick, setFsTick] = useState(0);

  const repo = pageSdk.repo();
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const quickOpenRef = useRef(quickOpen);
  quickOpenRef.current = quickOpen;
  // 编辑器 imperative 面（文件树重命名/删除/剪切后同步标签与 model）
  const editorRef = useRef<EditorPaneHandle | null>(null);

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

  // 外部文件变更（主进程 fs.watch → fs.changed，事件已防抖）：刷树 + 通知编辑器校验打开标签
  const fsTimer = useRef<number | null>(null);
  useEffect(() => {
    const off = pageSdk.on("fs.changed" as never, () => {
      if (fsTimer.current) window.clearTimeout(fsTimer.current);
      fsTimer.current = window.setTimeout(() => {
        fsTimer.current = null;
        void loadTree();
        setFsTick((v) => v + 1);
      }, 800);
    });
    return () => {
      if (fsTimer.current) window.clearTimeout(fsTimer.current);
      off();
    };
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

  // 任务页「内置编辑器」跳转（v3.1 变更面板）：打开指定文件（按 ts 去重）
  const fileFocus = useAppState().fileFocus;
  const handledFocusRef = useRef(0);
  useEffect(() => {
    if (fileFocus && fileFocus.ts !== handledFocusRef.current) {
      handledFocusRef.current = fileFocus.ts;
      openFile(fileFocus.path, { preview: false });
    }
  }, [fileFocus, openFile]);

  // 行内新建文件/文件夹：主进程创建（含 Windows 名校验/防竞态）→ 刷树 → 新文件转正打开
  const createEntry = useCallback(async (dir: string, name: string, kind: "file" | "dir"): Promise<boolean> => {
    if (!repo) return false;
    const rel = dir ? `${dir}/${name}` : name;
    try {
      const r = await pageSdk.call<{ ok: boolean; error?: string }>("file.create", { path: rel, kind });
      if (!r.ok) {
        const key = r.error === "exists" ? "Files_CreateExists"
          : r.error === "invalid_name" ? "Files_InvalidName" : "Files_CreateFailed";
        pageSdk.toast(pageSdk.t("Files_Title"), pageSdk.t(key));
        return false;
      }
      await loadTree();
      if (kind === "file") openFile(rel, { preview: false });
      return true;
    } catch (e) {
      pageSdk.toast(pageSdk.t("Files_Title"), (e as Error).message);
      return false;
    }
  }, [repo, loadTree, openFile]);

  // 打开的标签/激活位随文件系统操作迁移（目录按前缀整体改写）
  const remapTabs = useCallback((oldPath: string, newPath: string, isDir: boolean) => {
    const remap = (p: string) =>
      p === oldPath ? newPath : (isDir && p.startsWith(oldPath + "/") ? newPath + p.slice(oldPath.length) : p);
    setTabs((prev) => prev.map((tb) => ({ ...tb, path: remap(tb.path) })));
    setActiveTab((a) => (a ? remap(a) : a));
    editorRef.current?.handleFsRenamed(oldPath, newPath, isDir);
  }, []);

  // 右键/键盘重命名（同目录单段名）：主进程改名 → 标签迁移 → 刷树
  const renameEntry = useCallback(async (oldPath: string, newName: string, isDir: boolean): Promise<boolean> => {
    try {
      const r = await pageSdk.call<{ ok: boolean; error?: string }>("file.rename", { path: oldPath, name: newName });
      if (!r.ok) {
        const key = r.error === "exists" ? "Files_CreateExists"
          : r.error === "invalid_name" ? "Files_InvalidName"
          : r.error === "not_found" ? "Files_Missing" : "Files_RenameFailed";
        pageSdk.toast(pageSdk.t("Files_Title"), pageSdk.t(key));
        return false;
      }
      const parent = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/")) : "";
      remapTabs(oldPath, `${parent ? `${parent}/` : ""}${newName}`, isDir);
      await loadTree();
      return true;
    } catch (e) {
      pageSdk.toast(pageSdk.t("Files_Title"), (e as Error).message);
      return false;
    }
  }, [loadTree, remapTabs]);

  // 右键/键盘删除（目录递归、不可恢复，树内已 Modal 确认）：关闭受影响标签 → 刷树
  const deleteEntry = useCallback(async (path: string, isDir: boolean): Promise<boolean> => {
    const affected = (p: string) => p === path || (isDir && p.startsWith(path + "/"));
    try {
      const r = await pageSdk.call<{ ok: boolean; error?: string }>("file.delete", { path });
      if (!r.ok) {
        const key = r.error === "not_found" ? "Files_Missing" : "Files_DeleteFailed";
        pageSdk.toast(pageSdk.t("Files_Title"), pageSdk.t(key));
        return false;
      }
      // 激活位顺移邻位（与 closeTab 同语义）；被删文件的脏标签直接丢弃——文件已不存在
      const old = tabsRef.current;
      setTabs((prev) => prev.filter((tb) => !affected(tb.path)));
      setActiveTab((a) => {
        if (!a || !affected(a)) return a;
        const rest = old.filter((tb) => !affected(tb.path));
        const i = old.findIndex((tb) => tb.path === a);
        return rest[Math.min(i, rest.length - 1)]?.path ?? null;
      });
      editorRef.current?.handleFsDeleted(path, isDir);
      await loadTree();
      return true;
    } catch (e) {
      pageSdk.toast(pageSdk.t("Files_Title"), (e as Error).message);
      return false;
    }
  }, [loadTree]);

  // 右键粘贴（复制/剪切）：剪切 = 移动，打开的标签随路径迁移；复制重名由主进程自动「copy」序号
  const pasteEntry = useCallback(async (from: string, toDir: string, cut: boolean, fromIsDir: boolean): Promise<string | boolean> => {
    try {
      const r = await pageSdk.call<{ ok: boolean; path: string; error?: string }>("file.paste", { from, toDir, cut });
      if (!r.ok) {
        const key = r.error === "exists" ? "Files_CreateExists"
          : r.error === "not_found" ? "Files_Missing"
          : r.error === "invalid_name" ? "Files_InvalidName"
          : cut ? "Files_MoveFailed" : "Files_PasteFailed";
        pageSdk.toast(pageSdk.t("Files_Title"), pageSdk.t(key));
        return false;
      }
      await loadTree();
      if (cut) remapTabs(from, r.path, fromIsDir);
      return r.path;
    } catch (e) {
      pageSdk.toast(pageSdk.t("Files_Title"), (e as Error).message);
      return false;
    }
  }, [loadTree, remapTabs]);

  // 关闭标签（EditorPane 确认无未保存更改后回调）：激活位顺移邻位
  const closeTab = useCallback((path: string) => {
    const i = tabsRef.current.findIndex((x) => x.path === path);
    if (i < 0) return;
    const next = tabsRef.current.filter((x) => x.path !== path);
    setTabs(next);
    setActiveTab((a) => (a === path ? (next[Math.min(i, next.length - 1)]?.path ?? null) : a));
  }, []);

  // 固定/取消固定（固定 = 不再是预览；批量关闭跳过，× 换图钉）
  const togglePin = useCallback((path: string) => {
    setTabs((prev) => prev.map((tb) => (
      tb.path === path
        ? { path: tb.path, preview: tb.pinned ? tb.preview : false, pinned: !tb.pinned }
        : tb
    )));
  }, []);

  // 标签拖拽排序：from 移到 to 的位置
  const moveTab = useCallback((from: string, to: string) => {
    setTabs((prev) => {
      const fi = prev.findIndex((x) => x.path === from);
      const ti = prev.findIndex((x) => x.path === to);
      if (fi < 0 || ti < 0 || fi === ti) return prev;
      const next = prev.slice();
      const [m] = next.splice(fi, 1);
      next.splice(ti, 0, m);
      return next;
    });
  }, []);

  // 暂存单文件（编辑器 tab 菜单）
  const stageFile = useCallback(async (path: string): Promise<boolean> => {
    try {
      await pageSdk.call("changes.stage", { paths: [path] });
      await loadTree();
      return true;
    } catch (e) {
      pageSdk.toast(pageSdk.t("Files_Title"), (e as Error).message);
      return false;
    }
  }, [loadTree]);

  // 放弃单文件未提交修改（编辑器侧已确认）：成功后由 EditorPane 重载磁盘版
  const discardFile = useCallback(async (path: string): Promise<boolean> => {
    try {
      await pageSdk.call("changes.discardFile", { path });
      await loadTree();
      return true;
    } catch (e) {
      pageSdk.toast(pageSdk.t("Files_Title"), (e as Error).message);
      return false;
    }
  }, [loadTree]);

  // 外部文件拖入：绝对路径 → 仓库相对路径（仓库外提示）
  const openDropped = useCallback((abs: string) => {
    if (!repo) return;
    const rel = relOfWork(repo.workDir, abs);
    if (!rel || rel.length === 0) {
      pageSdk.toast(pageSdk.t("Files_Title"), pageSdk.t("Files_OutsideRepo"));
      return;
    }
    openFile(rel, { preview: false });
  }, [repo, openFile]);

  // path → git 状态码（标签名着色 + 页脚徽标）
  const statusByPath = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const e of treeData.entries) {
      if (!e.isDir) map[e.path] = e.status;
    }
    return map;
  }, [treeData.entries]);

  const allFiles = useMemo(() => treeData.entries.filter((e) => !e.isDir).map((e) => e.path), [treeData.entries]);

  // 全局快捷键：Ctrl+P 快速打开；Ctrl+Shift+F 仓库内搜索；Ctrl+B 收起/展开文件树
  // （Ctrl+Shift+P 是宿主命令面板，不能重复触发——Shift 组只放行 F）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.shiftKey) {
        if (k === "f") {
          e.preventDefault();
          setGlobalSearch((v) => !v);
        }
        return;
      }
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
            onCreate={createEntry}
            onRename={renameEntry}
            onDelete={deleteEntry}
            onPaste={pasteEntry}
            loading={loading}
            onRefresh={() => void loadTree()}
            onModeChange={setTreeMode}
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
          ref={editorRef}
          tabs={tabs}
          activeTab={activeTab}
          statusByPath={statusByPath}
          showDiff={treeMode === "git"}
          onActivateTab={activateTab}
          onPinTab={activateTab}
          onCloseTab={closeTab}
          onQuickOpen={() => setQuickOpen(true)}
          onToggleSidebar={() => setCollapsed(false)}
          onReveal={() => setRevealTick((v) => v + 1)}
          onSaved={() => void loadTree()}
          onMoveTab={moveTab}
          onTogglePin={togglePin}
          onStageFile={stageFile}
          onDiscardFile={discardFile}
          onOpenDropped={openDropped}
          reveal={reveal}
          fsTick={fsTick}
        />
        {quickOpen && (
          <QuickOpen
            files={allFiles}
            onOpen={(p) => openFile(p, { preview: true })}
            onClose={() => setQuickOpen(false)}
          />
        )}
        {globalSearch && (
          <GlobalSearch
            onOpen={(p, line) => {
              openFile(p, { preview: false });
              setReveal({ path: p, line, ts: Date.now() });
            }}
            onClose={() => setGlobalSearch(false)}
            onReplaced={() => void loadTree()}
          />
        )}
      </div>
    </div>
  );
}

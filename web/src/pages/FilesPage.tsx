import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pageSdk, useAppState } from "../pageSdk";
import { TreePane, type TreeEntry } from "./FilesTreePane";
import { EditorPane, type EditorPaneHandle, type EditorTab } from "./FilesEditorPane";
import { QuickOpen } from "./FilesQuickOpen";
import { GlobalSearch } from "./FilesGlobalSearch";
import { relOfWork } from "./filesPaths";
import { loadSession, saveSession, type EditorSession, type EditorSessionTab } from "./filesEditorSession";

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

/** 仓库切换 → 会话（标签/激活位/光标位置 + 查看模式 + 预览滚动）按仓库加载；无仓库返回空会话 */
function loadRepoSession(repo: { workDir: string; name: string } | null): EditorSession {
  return repo ? loadSession(repo.workDir) : { tabs: [], active: null, views: {}, modes: {} };
}

/** 仓库相对路径 → Monaco model 键（与 createTextModel 挂的 file URI 同形；
 *  不用 monaco.Uri——FilesPage 不依赖 Monaco 本体，避免页面间循环依赖）。 */
function monacoUriFor(path: string): string {
  return "file://" + path.replace(/\\/g, "/");
}

/** 会话锚点 → 当前内容中的实际行（抗文件改动错位）。
 *  锚点文本 = 上次光标所在行；在当前内容中就近搜索命中即按命中行定位，
 *  未命中（行已改写/删除）回退原行号并夹紧到文件内。
 *  读失败/文件不在时直接返回原行号。
 *  重要：仅当锚点文本在「原行」附近命中才采信——距离过远说明文件已被大幅改动
 *  或锚点文本极常见（如 `}`、import、空行），此时采信会把光标定位到完全无关的
 *  行；而该误定位会被持久化回去，下次重启原样重放，形成永久错位。 */
const ANCHOR_WINDOW = 40;
// 漂移容差：抗常见的 1–3 行插入/删除，但不接受大漂移——超过说明锚点文本是常见
// 短行（`}`、return、import）且原行已消失，命中的是无关行，采信即错位
const ANCHOR_MAX_DRIFT = 3;

async function resolveAnchor(repo: string, rel: string, line: number, col: number, text: string): Promise<number> {
  const clamp = (max: number) => Math.max(1, Math.min(line, max || 1));
  try {
    // maxBytes 2MB：只取定位所需的前段内容，不做全量读取
    const r = await pageSdk.call<{ content: string } | null>("file.content", { path: rel, maxBytes: 2 * 1024 * 1024 });
    if (!r) return line;
    const lines = r.content.split("\n");
    if (lines.length === 0) return 1;
    const target = (text || "").trimEnd();
    // 空锚点（光标停在空行）不匹配——空串与任意空行都相等，会把恢复位误判到第 1 行
    // 锚点过短（< 3 字符）同样歧义过大，不足以唯一定位，直接回退行号
    if (target && target.length >= 3 && target.length <= 200) {
      // 就近搜索：原行 ±ANCHOR_WINDOW 行窗口，命中最近的一处
      const win = Math.min(ANCHOR_WINDOW, Math.floor(lines.length / 2));
      const from = Math.max(0, line - 1 - win);
      const to = Math.min(lines.length, line + win);
      let best = -1;
      let bestDist = Infinity;
      for (let i = from; i < to; i++) {
        if ((lines[i] || "").trimEnd() === target) {
          const d = Math.abs(i + 1 - line);
          if (d < bestDist) { bestDist = d; best = i + 1; }
        }
      }
      // 只有漂移在容差内才采信：超过说明锚点已不可靠，回退原行号（由调用方夹紧）
      if (best > 0 && bestDist <= ANCHOR_MAX_DRIFT) return best;
    }
    return clamp(lines.length);
  } catch {
    return line;
  }
}

export function FilesPage() {
  const [treeData, setTreeData] = useState<{ entries: TreeEntry[]; hasMore: boolean }>({ entries: [], hasMore: false });
  // 标签/激活位初始化自会话持久化（跨窗口/重启恢复上次打开的文件）；
  // key 使 EditorPane 随仓库变化重置内部 model 缓存，避免跨仓库残留
  const [tabs, setTabs] = useState<EditorTab[]>(() => {
    const s = loadRepoSession(pageSdk.repo());
    return s.tabs.map((t) => ({ path: t.path, preview: !t.pinned, pinned: t.pinned }));
  });
  const [activeTab, setActiveTab] = useState<string | null>(() => {
    const s = loadRepoSession(pageSdk.repo());
    return s.tabs.some((t) => t.path === s.active) ? s.active : (s.tabs[0]?.path ?? null);
  });
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
  const repoKey = repo?.workDir ?? "";
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const quickOpenRef = useRef(quickOpen);
  quickOpenRef.current = quickOpen;
  // 编辑器 imperative 面（文件树重命名/删除/剪切后同步标签与 model）
  const editorRef = useRef<EditorPaneHandle | null>(null);

  // ---- 会话持久化（标签/激活位 + 光标位置；按仓库隔离，多窗口共享）----
  const sessionsRef = useRef<Record<string, EditorSession>>({});
  sessionsRef.current[repoKey] ??= loadRepoSession(repo);
  const session = sessionsRef.current[repoKey];
  const sessionSeqRef = useRef(0);

  // 待补记锚点文本的位置（uri → 行/列）：锚点文本在会话恢复时为空，
  // 首次写入该行位置时异步读取文件补记，保证下次恢复有锚点可用
  const pendingAnchorRef = useRef(new Map<string, { path: string; line: number; col: number }>());

  // 补记锚点文本（当前文件中该行的文本），写入会话后落盘
  const fillAnchorText = useCallback(async (uri: string) => {
    const item = pendingAnchorRef.current.get(uri);
    const s = sessionsRef.current[repoKey];
    if (!item || !s) return;
    try {
      const r = await pageSdk.call<{ content: string } | null>("file.content", { path: item.path, maxBytes: 2 * 1024 * 1024 });
      if (!r) return;
      const lines = r.content.split("\n");
      const line = Math.max(1, Math.min(item.line, lines.length || 1));
      const text = (lines[line - 1] ?? "").trimEnd();
      const v = s.views[uri];
      // 空行：锚点无法用于就近搜索（resolveAnchor 跳过空锚点），回退行号定位，不再补记
      if (!text) { pendingAnchorRef.current.delete(uri); return; }
      if (!v?.anchor) return;
      v.anchor.text = text;
      pendingAnchorRef.current.delete(uri);
      saveSession(repoKey, s);
    } catch {
      // 读取失败：保留行号锚点，下次恢复回退行号定位
    }
  }, [repoKey]);

  // 标签/激活位变化 → 记入会话并落盘（位置由 onPositionReport 写入同一份会话）
  useEffect(() => {
    if (!repoKey) return;
    const s = sessionsRef.current[repoKey];
    if (!s) return;
    s.tabs = tabs.map((t) => ({ path: t.path, pinned: !!t.pinned }));
    s.active = tabs.some((t) => t.path === activeTab) ? activeTab : null;
    saveSession(repoKey, s);
  }, [repoKey, tabs, activeTab]);

  // 光标位置回报：写行/列（锚点文本异步补记）并落盘。
  // 用 ref 读当前仓库键——回调在文件加载期被快速连续调用，闭包捕获的 repoKey 可能滞后一个提交
  const repoKeyRef = useRef(repoKey);
  repoKeyRef.current = repoKey;
  const positionReport = useCallback((path: string, line: number, col: number) => {
    const rk = repoKeyRef.current;
    const s = sessionsRef.current[rk];
    if (!s) return;
    const uri = monacoUriFor(path);
    const v = (s.views[uri] ??= {});
    v.anchor = { line, col, text: v.anchor?.text ?? "" };
    if (!v.anchor.text) {
      pendingAnchorRef.current.set(uri, { path, line, col });
      void fillAnchorText(uri);
    }
    saveSession(rk, s);
  }, [fillAnchorText]);

  // 查看模式回报（md/html 等查看器文件在编辑/预览间切换）：落盘下次重开时恢复。
  // 仅当文件有查看器时该 mode 才有意义，普通代码文件不需要（但也不会上报，安全）
  const modeReport = useCallback((path: string, mode: "edit" | "preview") => {
    const s = sessionsRef.current[repoKey];
    if (!s) return;
    if (!s.modes) s.modes = {};
    if (s.modes[path] === mode) return;
    s.modes[path] = mode;
    saveSession(repoKey, s);
  }, [repoKey]);

  // 预览态滚动位置回报（md/html 预览面板 onScroll）：落盘下次重开时恢复
  const previewScrollReport = useCallback((path: string, top: number) => {
    const s = sessionsRef.current[repoKey];
    if (!s) return;
    const uri = monacoUriFor(path);
    const v = (s.views[uri] ??= {});
    if (v.previewScroll === top) return;
    v.previewScroll = top;
    saveSession(repoKey, s);
  }, [repoKey]);

  // 卸载时兜底落盘一次（标签 effect 已覆盖常规路径；此处针对最后阶段的位置回报）
  useEffect(() => () => {
    if (repoKey && sessionsRef.current[repoKey]) saveSession(repoKey, sessionsRef.current[repoKey]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoKey]);
  // 首开定位：会话锚点 → 行/列（锚点文本抗文件改动错位，当前内容中就近搜索后取实际行）
  const [initialReveals, setInitialReveals] = useState<Record<string, { line: number; col: number; ts: number }> | null>(null);
  useEffect(() => {
    if (!repoKey || !repo) {
      setInitialReveals(null);
      return;
    }
    let cancelled = false;
    const paths = tabs.map((t) => t.path);
    (async () => {
      const out: Record<string, { line: number; col: number; ts: number }> = {};
      for (const p of paths) {
        const v = session.views[monacoUriFor(p)];
        if (!v?.anchor) continue;
        const line = await resolveAnchor(repo.workDir, p, v.anchor.line, v.anchor.col, v.anchor.text);
        out[p] = { line, col: v.anchor.col, ts: ++sessionSeqRef.current };
      }
      if (!cancelled) setInitialReveals(Object.keys(out).length > 0 ? out : null);
    })();
    return () => { cancelled = true; };
    // 定位是「首开」语义：仓库/标签集变化时重算一次，后续开关标签不再重复触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoKey, tabs.map((t) => t.path).join("|")]);

  // 首开查看模式：从会话 modes 表读出（仅对有查看器的文件生效，md/html）；
  // 编辑/预览状态在会话恢复后应用；预览态首次挂 preview iframe 前注入初始滚动
  const initialModes = useMemo(() => {
    if (!session.modes || Object.keys(session.modes).length === 0) return null;
    const m = new Map<string, "edit" | "preview">();
    for (const p of tabs) {
      const mode = session.modes[p.path];
      if (mode) m.set(p.path, mode);
    }
    return m.size > 0 ? m : null;
  }, [session.modes, tabs.map((t) => t.path).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  // 首开预览滚动：从会话 views[uri].previewScroll 读出，仅当该文件当前处于预览态时消费
  const initialPreviewScrolls = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of tabs) {
      const top = session.views[monacoUriFor(p.path)]?.previewScroll;
      if (typeof top === "number" && Number.isFinite(top)) m.set(p.path, top);
    }
    return m.size > 0 ? m : null;
  }, [session.views, tabs.map((t) => t.path).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

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
            key={repo.workDir}
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
          key={repoKey}
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
          initialReveals={initialReveals ?? undefined}
          onPositionReport={positionReport}
          initialModes={initialModes ?? undefined}
          onModeChange={modeReport}
          initialPreviewScrolls={initialPreviewScrolls ?? undefined}
          onPreviewScroll={previewScrollReport}
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

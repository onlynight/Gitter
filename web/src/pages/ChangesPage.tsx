import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pageSdk, useAppState } from "../pageSdk";
import { seamMenuItems } from "../commands";
import { Banner, DiffView, Modal, ScrollArea, SplitPane, SyncBar, useSyncProgress, useContextMenu, type CtxMenuItem } from "../kit";
import { TlIcon } from "./taskIcons";
import type { ChangesStateDTO, DiffDTO, FileStatusDTO } from "../bridge/types";

// R1 宿主面收敛：本页只经 pageSdk 消费宿主（ui-full-pluginization-plan.md R1）
const { call, t, navigate, notifyRepoChanged, openSettings, setContext: setSharedContext } = pageSdk;
const useApp = useAppState;

// 提交类型前缀：收进图标下拉（changes-commit-prefix-dropdown-design.md），类型清单不变
const PREFIX_ITEMS = [
  { pfx: "feat:", descKey: "Changes_PrefixFeat" },
  { pfx: "fix:", descKey: "Changes_PrefixFix" },
  { pfx: "docs:", descKey: "Changes_PrefixDocs" },
  { pfx: "test:", descKey: "Changes_PrefixTest" },
  { pfx: "build:", descKey: "Changes_PrefixBuild" },
  { pfx: "chore:", descKey: "Changes_PrefixChore" },
];

// 可直接预览的文件扩展名（与 app/src/services/preview.ts 的 MIME 表保持同步）
const PREVIEW_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif", ".ico", ".svg"]);

function previewable(p: string): boolean {
  const dot = p.lastIndexOf(".");
  return dot >= 0 && PREVIEW_EXTS.has(p.slice(dot).toLowerCase());
}

interface PreviewDTO {
  mime: string;
  base64: string;
  fromIndex: boolean;
  tooLarge?: boolean;
}

interface SafetyFindingDTO {
  ruleId: string;
  severity: "warning" | "blocked";
  filePath: string;
  line: number | null;
  message: string;
}

interface AgentFeedbackDTO {
  note: string;
  path: string | null;
  createdAt: string;
}

export function ChangesPage() {
  const app = useApp();
  const repo = app.repo;
  const [state, setStateDto] = useState<ChangesStateDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [transient, setTransient] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ path: string; staged: boolean; isNew: boolean; isConflict: boolean } | null>(null);
  // U1b 共享上下文镜像（外部页/跨页联动读取）
  useEffect(() => {
    setSharedContext({ selectedFile: selected });
  }, [selected]);
  const [diff, setDiff] = useState<DiffDTO | null>(null);
  const [preview, setPreview] = useState<PreviewDTO | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  // 提交勾选语义（v2 重构）：勾选 = 参与本次提交。已暂存行默认参与（勾选态），
  // 用反向集合记录「用户显式排除」的暂存路径——修复旧版默认全不勾选、
  // 提交时把整个暂存区 unstage 导致必失败的倒置语义。未暂存行保持正向勾选（提交时暂存）。
  const [excludedStaged, setExcludedStaged] = useState<Set<string>>(new Set());
  // 文件筛选（路径包含匹配；Esc 清空）
  const [filter, setFilter] = useState("");
  // 分组折叠（组键 = 稳定 id，与语言无关；localStorage 持久化——跨页导航/重启保留）
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("gitter:changes:collapsedGroups") ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  const toggleGroup = (gkey: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(gkey)) next.delete(gkey);
      else next.add(gkey);
      try {
        localStorage.setItem("gitter:changes:collapsedGroups", JSON.stringify([...next]));
      } catch { /* 无 localStorage（纯浏览器调试） */ }
      return next;
    });
  const [selectedHunks, setSelectedHunks] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState("");
  // 提交类型前缀下拉（向上弹；点击外部关闭对齐 kit/Select 惯例）
  const [prefixOpen, setPrefixOpen] = useState(false);
  const [prefixHi, setPrefixHi] = useState(-1);
  const prefixRef = useRef<HTMLDivElement | null>(null);
  const commitInputRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!prefixOpen) return;
    const close = (e: MouseEvent) => {
      if (!prefixRef.current?.contains(e.target as Node)) setPrefixOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [prefixOpen]);
  // 插入语义与原 chips 一致：仅空消息打底；选后关菜单、焦点回输入框
  const insertPrefix = (pfx: string) => {
    setMessage((m) => (m.trim() ? m : pfx + " "));
    setPrefixOpen(false);
    setPrefixHi(-1);
    commitInputRef.current?.focus();
  };
  const [busy, setBusy] = useState(false);
  const [findings, setFindings] = useState<SafetyFindingDTO[]>([]);
  // 安全网发现交互：展开全部 / 逐条标记已解决（localStorage 持久化，仅隐藏横幅——
  // 主进程提交门每次独立重扫，拦截语义不受 UI 标记影响）/ 跳转到问题行
  const [showAllFindings, setShowAllFindings] = useState(false);
  const [resolvedFindings, setResolvedFindings] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("gitter:changes:resolvedFindings") ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  const [focusLine, setFocusLine] = useState<{ line: number; ts: number } | null>(null);
  const findingKey = (f: SafetyFindingDTO) => `${f.ruleId}|${f.filePath}|${f.line ?? ""}`;
  const dismissFinding = (f: SafetyFindingDTO) =>
    setResolvedFindings((prev) => {
      const next = new Set(prev);
      next.add(findingKey(f));
      try {
        localStorage.setItem("gitter:changes:resolvedFindings", JSON.stringify([...next]));
      } catch { /* 无 localStorage */ }
      return next;
    });
  const activeFindings = findings.filter((f) => !resolvedFindings.has(findingKey(f)));
  const jumpToFinding = (f: SafetyFindingDTO) => {
    // 优先应用内跳转：选中该文件（加载 diff）→ DiffView 滚动到问题行；
    // 文件不在本次变更里（如已暂存侧/已提交后残留）→ 退回外部编辑器打开
    const unstaged = state?.changes.find((x) => x.path === f.filePath);
    const staged = state?.staged.find((x) => x.path === f.filePath);
    const conflict = state?.conflicts.find((x) => x.path === f.filePath);
    const target = unstaged ?? staged ?? conflict;
    if (target) {
      select(target, !unstaged && !!staged);
      if (f.line) setFocusLine({ line: f.line, ts: Date.now() });
    } else {
      void call("shell.openPath", { path: f.filePath, editor: true });
    }
  };
  const [feedback, setFeedback] = useState<AgentFeedbackDTO | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [explainText, setExplainText] = useState<{ title: string; text: string } | null>(null);
  const [createBranch, setCreateBranch] = useState<string | null>(null);
  const [pushErrorKind, setPushErrorKind] = useState<string | null>(null);
  const { showMenu, menuElement } = useContextMenu();
  const transientTimer = useRef<number | null>(null);
  const [syncProgress, clearSyncProgress] = useSyncProgress();

  const reload = useCallback(async () => {
    if (!repo) return;
    try {
      const s = await call<ChangesStateDTO>("changes.state");
      setStateDto(s);
      setError(null);
      setErrorDetail(null);
      // 安全网扫描 + agent 反馈（辅助信息，失败不阻断列表）
      try {
        const r = await call<{ findings: SafetyFindingDTO[] }>("changes.safetyScan");
        setFindings(r.findings);
      } catch {
        setFindings([]);
      }
      setFeedback(await call<AgentFeedbackDTO | null>("changes.feedback"));
    } catch (e) {
      setError((e as Error).message);
      setErrorDetail((e as { detail?: string }).detail ?? null);
    }
  }, [repo]);

  // 数据加载：仓库切换 / F5 / 任何改仓操作（本页或其它页/任务广播）→ 重拉
  useEffect(() => {
    if (!repo) { setStateDto(null); return; }
    void reload();
  }, [repo, app.refreshTick, app.repoChangedTick]);

  // F5 / 仓库切换语义：额外重置本地 UI 态（数据级广播不清空正在输入的内容与选中）
  useEffect(() => {
    if (!repo) return;
    setSelected(null);
    setDiff(null);
    setMessage("");
    setChecked(new Set());
    setExcludedStaged(new Set());
    setFilter("");
  }, [repo, app.refreshTick]);

  const showTransient = (text: string) => {
    setTransient(text);
    if (transientTimer.current) window.clearTimeout(transientTimer.current);
    transientTimer.current = window.setTimeout(() => setTransient(null), 5000);
  };

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    try {
      const msg = await fn();
      if (typeof msg === "string") showTransient(msg);
      notifyRepoChanged(); // 本页与其它 git 页（Log/Branches）一并数据重拉
      if (selected) await loadDiff(selected);
    } catch (e) {
      setError((e as Error).message);
      setErrorDetail((e as { detail?: string }).detail ?? null);
    } finally {
      clearSyncProgress();
      setBusy(false);
    }
  };

  const loadDiff = useCallback(async (sel: { path: string; staged: boolean; isNew: boolean; isConflict?: boolean }) => {
    setPreview(null);
    setSelectedHunks(new Set());
    // 图片等可预览二进制：直接出内容，不请求 diff
    if (previewable(sel.path)) {
      try {
        const p = await call<PreviewDTO>("file.preview", { path: sel.path, staged: sel.staged });
        setPreview(p);
        setDiff(null);
        return;
      } catch {
        // 读取失败（文件消失等）→ 回退 diff 路径
      }
    }
    try {
      const d = await call<DiffDTO>("changes.diffFile", { path: sel.path, staged: sel.staged, isNewFile: sel.isNew });
      setDiff(d);
    } catch (e) {
      setDiff(null);
      setError((e as Error).message);
    }
  }, []);

  // run 经 ref 间接引用，保持 hunk 回调引用稳定——DiffView 已 memo 化（浅比较），
  // 内联箭头函数会让每次全页重渲染都穿透 memo、重协调整棵 diff 树
  const runRef = useRef(run);
  runRef.current = run;

  const toggleHunk = useCallback((i: number) => {
    setSelectedHunks((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);

  const hunkActionLabel = useCallback(
    (_i: number) => (selected?.staged ? t("Changes_UnstageHunk") : t("Changes_StageHunk")),
    [selected],
  );

  const hunkAction = useCallback(
    (i: number) => {
      const sel = selected;
      if (!sel) return;
      if (sel.staged) {
        void runRef.current(async () => { await call("changes.unstageHunks", { path: sel.path, indices: [i] }); return t("Changes_UnstagedHunks"); });
      } else if (!sel.isNew) {
        void runRef.current(async () => { await call("changes.stageHunks", { path: sel.path, indices: [i] }); return t("Changes_StagedHunks"); });
      }
    },
    [selected],
  );

  const select = (f: FileStatusDTO, stagedView: boolean) => {
    const sel = { path: f.path, staged: stagedView, isNew: f.category === "unversioned", isConflict: f.isConflict };
    setSelected(sel);
    void loadDiff(sel);
  };

  const allFiles = useMemo(
    () => (state ? [...state.staged, ...state.changes, ...state.unversioned, ...state.conflicts] : []),
    [state],
  );

  const stagedPaths = useMemo(
    () => allFiles.filter((f) => checked.has(f.path) && f.category !== "staged" && f.category !== "conflicts").map((f) => f.path),
    [allFiles, checked],
  );
  // 本次提交将包含的文件 = 暂存区（未被显式排除的） + 勾选的未暂存文件；附行数汇总供提交框展示
  const commitStat = useMemo(() => {
    if (!state) return { n: 0, added: 0, deleted: 0 };
    const files = [
      ...state.staged.filter((f) => !excludedStaged.has(f.path)),
      ...allFiles.filter((f) => checked.has(f.path) && f.category !== "staged" && f.category !== "conflicts"),
    ];
    let added = 0;
    let deleted = 0;
    for (const f of files) {
      added += f.added ?? 0;
      deleted += f.deleted ?? 0;
    }
    return { n: files.length, added, deleted };
  }, [state, allFiles, checked, excludedStaged]);
  const canCommit =
    !!state &&
    (state.staged.some((f) => !excludedStaged.has(f.path)) || stagedPaths.length > 0) &&
    message.trim().length > 0 &&
    !busy;

  const doCommit = async (push: boolean) => {
    if (!canCommit) return;
    setBusy(true);
    try {
      const r = await call<{ sha: string | null; pushError: string | null }>("changes.commit", {
        message: message.trim(),
        push,
        toStage: stagedPaths,
        toUnstage: [...excludedStaged],
      });
      setMessage("");
      setChecked(new Set());
      if (r.pushError) {
        setError(t("Changes_PushFailed", r.pushError));
        setErrorDetail(null);
      } else {
        showTransient(push ? t("Changes_CommittedAndPushed") : t("Changes_Committed"));
      }
      notifyRepoChanged();
    } catch (e) {
      const err = e as Error & { detail?: string };
      setError(err.message);
      setErrorDetail(err.detail ?? null);
    } finally {
      clearSyncProgress();
      setBusy(false);
    }
  };

  // AI 生成提交信息（隐私分级在主进程执行）
  const generateMessage = async () => {
    setAiBusy(true);
    try {
      const r = await call<{ message: string }>("ai.generateCommitMessage");
      setMessage((m) => (m.trim() ? m : r.message));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      clearSyncProgress();
      setAiBusy(false);
    }
  };

  // AI 解释 / 审查（所选文件优先，无选择 = 全部 staged）
  const explain = async (intent: "explain" | "review") => {
    setAiBusy(true);
    try {
      const r = await call<{ text: string }>("ai.explain", { intent, path: selected?.staged ? selected.path : null });
      setExplainText({ title: intent === "review" ? t("Changes_AiReview") : t("Changes_AiExplain"), text: r.text });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      clearSyncProgress();
      setAiBusy(false);
    }
  };

  // 推送（失败分类进横幅；noUpstream 附带自助修复动作）
  const doPush = async () => {
    setBusy(true);
    try {
      const err = await call<string | null>("changes.push", {});
      if (err) {
        setPushErrorKind(err);
        setError(t("Changes_PushFailed", err));
        setErrorDetail(null);
      } else {
        setPushErrorKind(null);
        showTransient(t("Changes_Pushed"));
        notifyRepoChanged();
      }
    } catch (e) {
      setError((e as Error).message);
      setErrorDetail((e as { detail?: string }).detail ?? null);
    } finally {
      clearSyncProgress();
      setBusy(false);
    }
  };

  // 一键设置上游并推送（noUpstream 错误的修复动作）
  const doSetUpstreamPush = async () => {
    setBusy(true);
    try {
      const r = await call<{ pushed: boolean; remote: string; branch: string; errorKind: string | null }>("changes.pushSetUpstream");
      if (r.pushed) {
        setPushErrorKind(null);
        setError(null);
        setErrorDetail(null);
        showTransient(t("Changes_UpstreamPushed", r.remote, r.branch));
        notifyRepoChanged();
      } else {
        setPushErrorKind(r.errorKind);
        setError(t("Changes_PushFailed", r.errorKind ?? "other"));
      }
    } catch (e) {
      setPushErrorKind(null);
      setError((e as Error).message);
      setErrorDetail((e as { detail?: string }).detail ?? null);
    } finally {
      clearSyncProgress();
      setBusy(false);
    }
  };

  // 命令面板路由（changes.commit / changes.commitPush / changes.stageAll / changes.unstageAll）
  useEffect(() => {
    const cmd = app.routedCommand;
    if (!cmd || app.page !== "changes") return;
    if (cmd.id === "changes.commit") void doCommit(false);
    else if (cmd.id === "changes.commitPush") void doCommit(true);
    else if (cmd.id === "changes.stageAll") {
      const paths = [...(state?.changes ?? []), ...(state?.unversioned ?? [])].map((f) => f.path);
      void run(async () => { await call("changes.stage", { paths }); return t("Changes_StagedAll"); });
    } else if (cmd.id === "changes.unstageAll") {
      const paths = (state?.staged ?? []).map((f) => f.path);
      void run(async () => { await call("changes.unstage", { paths }); return t("Changes_UnstagedAll"); });
    }
  }, [app.routedCommand]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!repo) {
    return <div className="empty-state"><div className="big">◇</div>{t("Common_NoProjectSelected")}</div>;
  }

  const q = filter.trim().toLowerCase();

  /** 文件行（v2）：复选框 + 状态徽标 + 分层路径（目录淡化/文件名全亮）+ 行尾统计，悬停统计让位给暂存动作。 */
  const renderRow = (f: FileStatusDTO, stagedView: boolean, checkable: boolean) => {
    const letter = letterOf(f);
    const { dir, base } = splitPath(f.path);
    const isConflict = f.isConflict;
    const include = f.category === "staged" ? !excludedStaged.has(f.path) : checked.has(f.path);
    const toggleInclude = () => {
      // 两个集合翻转语义一致：已暂存集合存「排除」、其余存「勾选」，都是 has?删:加
      const setter = f.category === "staged" ? setExcludedStaged : setChecked;
      setter((prev) => {
        const next = new Set(prev);
        if (next.has(f.path)) next.delete(f.path);
        else next.add(f.path);
        return next;
      });
    };
    const stageOne = () =>
      void run(async () => { await call("changes.stage", { paths: [f.path] }); return t("Changes_Staged"); });
    const unstageOne = () =>
      void run(async () => { await call("changes.unstage", { paths: [f.path] }); return t("Changes_Unstaged"); });
    return (
      <div
        key={f.category + f.path}
        className={"chg-row" + (selected?.path === f.path && selected?.staged === stagedView ? " selected" : "") + (isConflict ? " conflict" : "")}
        onClick={() => select(f, stagedView)}
        onContextMenu={(e) => {
          // menus 接缝（extension-system-v2.md §16.5）：本地动作 + 内置文件菜单（走接缝） + 包菜单
          void (async () => {
            const local: CtxMenuItem[] = [
              stagedView
                ? { label: t("Changes_UnstageFile"), action: unstageOne }
                : { label: t("Changes_StageFile"), action: stageOne },
              ...(isConflict ? [{ label: t("Changes_MarkResolved"), action: stageOne }] : []),
              { sep: true, label: "", action: () => {} },
            ];
            showMenu(e, [...local, ...(await seamMenuItems("changesFile", f.path))]);
          })();
        }}
      >
        {checkable && !isConflict && (
          <input
            type="checkbox"
            checked={include}
            onChange={toggleInclude}
            onClick={(e) => e.stopPropagation()}
            data-tip={t("Changes_IncludeCommit")}
          />
        )}
        <span className={"status-letter " + (letter === "?" ? "st-U" : "st-" + letter)}>{letter}</span>
        <span className="chg-path" title={f.path}>
          {dir && <><span className="dir">{dir}</span><span className="sep">/</span></>}
          <span className="base">{base}</span>
        </span>
        <span className="chg-tail">
          <span className="chg-stats">
            {f.added !== null && <span className="diff-stats-add">+{f.added}</span>}
            {f.deleted !== null && <span className="diff-stats-del">−{f.deleted}</span>}
          </span>
          {!isConflict && (
            <span className="chg-act">
              {stagedView ? (
                <button className="icon-btn" data-tip={t("Changes_UnstageFile")} disabled={busy}
                  onClick={(e) => { e.stopPropagation(); unstageOne(); }}>
                  <TlIcon name="down" size={12} />
                </button>
              ) : (
                <button className="icon-btn" data-tip={t("Changes_StageFile")} disabled={busy}
                  onClick={(e) => { e.stopPropagation(); stageOne(); }}>
                  <TlIcon name="up" size={12} />
                </button>
              )}
            </span>
          )}
        </span>
      </div>
    );
  };

  const group = (
    gkey: string,
    title: string,
    files: FileStatusDTO[],
    stagedView: boolean,
    opts: { checkable: boolean; act: "stage" | "unstage" | null },
  ) => {
    const visible = q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files;
    if (visible.length === 0) return null;
    const collapsed = collapsedGroups.has(gkey);
    // 组头三态复选框：全选/全不选该组参与本次提交（已暂存组 = 全部参与/全部排除）
    const eligible = files.filter((f) => !f.isConflict);
    const includeOf = (f: FileStatusDTO) => (f.category === "staged" ? !excludedStaged.has(f.path) : checked.has(f.path));
    const allOn = eligible.length > 0 && eligible.every(includeOf);
    const someOn = eligible.some(includeOf);
    const toggleAllInclude = () => {
      const targetOn = !allOn;
      const setter = stagedView ? setExcludedStaged : setChecked;
      setter((prev) => {
        const next = new Set(prev);
        for (const f of eligible) {
          if (stagedView) {
            if (targetOn) next.delete(f.path); // 重新参与 = 移出排除集
            else next.add(f.path);
          } else {
            if (targetOn) next.add(f.path);
            else next.delete(f.path);
          }
        }
        return next;
      });
    };
    const actAll = () => {
      const paths = visible.map((f) => f.path);
      if (opts.act === "stage") {
        void run(async () => { await call("changes.stage", { paths }); return t("Changes_Staged"); });
      } else {
        void run(async () => { await call("changes.unstage", { paths }); return t("Changes_Unstaged"); });
      }
    };
    return (
      <div key={gkey}>
        <div className={"chg-group-h" + (gkey === "conflicts" ? " warn" : "")} onClick={() => toggleGroup(gkey)}>
          {opts.checkable && eligible.length > 0 && (
            <input
              type="checkbox"
              checked={allOn}
              ref={(el) => { if (el) el.indeterminate = someOn && !allOn; }}
              onChange={toggleAllInclude}
              onClick={(e) => e.stopPropagation()}
              data-tip={t("Changes_IncludeCommit")}
            />
          )}
          <TlIcon name="chevron-down" size={11} className={collapsed ? "cv-closed" : undefined} />
          <span>{title}</span>
          <span className="chg-cnt">{visible.length}</span>
          <span style={{ flex: 1 }} />
          {opts.act && (
            <span className="chg-gacts" onClick={(e) => e.stopPropagation()}>
              <button
                className="icon-btn"
                data-tip={opts.act === "stage" ? t("Changes_StageGroup") : t("Changes_UnstageGroup")}
                disabled={busy}
                onClick={actAll}
              >
                <TlIcon name={opts.act === "stage" ? "plus" : "down"} size={12} />
              </button>
            </span>
          )}
        </div>
        {!collapsed && visible.map((f) => renderRow(f, stagedView, opts.checkable))}
      </div>
    );
  };

  const hasSelectedHunks = selectedHunks.size > 0 && diff && !diff.isBinary;

  // 右侧文件头数据：在对应分组里找回所选文件（拿 code 与行数统计）
  const selectedFile = useMemo(() => {
    if (!selected || !state) return null;
    const list = selected.staged ? state.staged : selected.isConflict ? state.conflicts : selected.isNew ? state.unversioned : state.changes;
    return list.find((f) => f.path === selected.path) ?? null;
  }, [selected, state]);
  const selLetter = selectedFile ? letterOf(selectedFile) : "";
  const selSplit = selected ? splitPath(selected.path) : { dir: "", base: "" };

  return (
    <>
      {error && (
        <Banner
          text={error}
          error
          detail={errorDetail ?? undefined}
          onCopyDetail={errorDetail ? () => navigator.clipboard.writeText(errorDetail) : undefined}
          onClose={() => { setError(null); setErrorDetail(null); setPushErrorKind(null); }}
          actions={
            pushErrorKind === "noUpstream"
              ? [
                  { label: t("Changes_SetUpstreamPush"), onClick: () => void doSetUpstreamPush() },
                  { label: t("Common_GoToSettings"), onClick: () => openSettings("git") },
                ]
              : pushErrorKind === "noRemote" || errorDetail === "NO_REMOTE"
                ? [{ label: t("Common_GoToSettings"), onClick: () => openSettings("git") }]
                : undefined
          }
        />
      )}
      {transient && <Banner text={transient} onClose={() => setTransient(null)} />}
      {busy && <SyncBar progress={syncProgress} />}
      {feedback && (
        <Banner
          text={t("Changes_AgentFeedback", feedback.note)}
          detail={feedback.path ?? undefined}
          onOpenDetail={feedback.path ? () => void call("shell.openPath", { path: feedback.path, editor: true }) : undefined}
          onClose={async () => { await call("changes.clearFeedback", {}); setFeedback(null); }}
          actions={[
            {
              label: t("Changes_SendToRepair"),
              onClick: () => void (async () => {
                try {
                  const r = await call<{ task: { taskId: string; title: string } }>("review.repair", {});
                  setFeedback(null);
                  setTransient(t("Changes_RepairSent", r.task.title));
                  navigate("tasks");
                } catch (e) {
                  setTransient((e as Error).message);
                }
              })(),
            },
          ]}
        />
      )}
      {activeFindings.length > 0 && (
        <div
          className={"banner" + (activeFindings.some((f) => f.severity === "blocked") ? " error" : "")}
          style={{ flexDirection: "column", alignItems: "stretch", gap: 2 }}
        >
          {(showAllFindings ? activeFindings : activeFindings.slice(0, 6)).map((f, i) => (
            <div key={findingKey(f) + i} className="banner-text" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className={"b-ico " + (f.severity === "blocked" ? "err" : "warn")}>{f.severity === "blocked" ? "✕" : "!"}</span>
              <span
                className="finding-link"
                style={{ fontFamily: "var(--mono)", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2, color: "var(--c-link)" }}
                onClick={() => jumpToFinding(f)}
                title={t("Changes_JumpToFinding")}
              >
                {f.filePath}{f.line ? `:${f.line}` : ""}
              </span>
              <span style={{ color: "var(--c-text2)" }}>— {f.message}</span>
              <span style={{ flex: 1 }} />
              <button
                className="tool-btn icon sm"
                data-tip={t("Changes_MarkResolved")}
                style={{ width: 22, height: 18 }}
                onClick={() => dismissFinding(f)}
              >
                <span className="glyph" style={{ fontSize: 10 }}>{""}</span>
              </button>
            </div>
          ))}
          {!showAllFindings && activeFindings.length > 6 && (
            <button
              className="tool-btn icon sm"
              data-tip={t("Changes_MoreFindings", activeFindings.length - 6)}
              style={{ width: 22, height: 22, color: "var(--c-link)" }}
              onClick={() => setShowAllFindings(true)}
            >
              <span className="glyph" style={{ fontSize: 10 }}>{""}</span>
            </button>
          )}
          {showAllFindings && activeFindings.length > 6 && (
            <button
              className="tool-btn icon sm"
              data-tip={t("Common_Collapse")}
              style={{ width: 22, height: 22 }}
              onClick={() => setShowAllFindings(false)}
            >
              <span className="glyph" style={{ fontSize: 10, transform: "rotate(180deg)" }}>{""}</span>
            </button>
          )}
        </div>
      )}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: "10px 12px 12px" }}>
      <SplitPane settingKey="changesSplitterFraction" initial={0.38} a={
        <div className="split-pane chg-left" style={{ display: "flex", flexDirection: "column" }}>
          {/* 侧栏头：分支上下文 + 同步动作（原页面级工具栏收编于此，changes-left-v2-mockup ①） */}
          <div className="chg-head">
            <button className="chg-branch" data-tip={t("Changes_BranchSwitch")} onClick={() => navigate("branches")}>
              <TlIcon name="branch" size={12} />
              <span className="mono">{state?.branch ?? "—"}</span>
            </button>
            {state && !!state.ahead && !!state.behind && (
              <span className="chg-sync" data-tip={t("Changes_AheadBehind", state.ahead, state.behind)}>
                <TlIcon name="up" size={10} className="up" /><span className="up">{state.ahead}</span>
                <TlIcon name="down" size={10} className="dn" /><span className="dn">{state.behind}</span>
              </span>
            )}
            {state && !!state.ahead && !state.behind && (
              <span className="chg-sync" data-tip={t("Changes_Ahead", state.ahead)}>
                <TlIcon name="up" size={10} className="up" /><span className="up">{state.ahead}</span>
              </span>
            )}
            {state && !state.ahead && !!state.behind && (
              <span className="chg-sync" data-tip={t("Changes_AheadBehind", 0, state.behind)}>
                <TlIcon name="down" size={10} className="dn" /><span className="dn">{state.behind}</span>
              </span>
            )}
            <span style={{ flex: 1 }} />
            <button className="icon-btn" data-tip={t("Changes_Fetch")} disabled={busy} onClick={() => void run(async () => { await call("changes.fetch", {}); return t("Changes_Fetched"); })}>
              <TlIcon name="sync" size={13} />
            </button>
            <button className="icon-btn" data-tip={t("Changes_Pull")} disabled={busy} onClick={() => void run(async () => { await call("changes.pull", { rebase: false }); return t("Changes_Pulled"); })}>
              <TlIcon name="download" size={13} />
            </button>
            <button className="icon-btn" data-tip={t("Changes_PullRebase")} disabled={busy} onClick={() => void run(async () => { await call("changes.pull", { rebase: true }); return t("Changes_PulledRebase"); })}>
              <TlIcon name="down" size={13} />
            </button>
            <button className="icon-btn" data-tip={t("Changes_Push")} disabled={busy} onClick={() => void doPush()}>
              <TlIcon name="up" size={13} />
            </button>
            <button className="icon-btn" data-tip={t("Branches_CreateTitle")} onClick={() => setCreateBranch("")}>
              <TlIcon name="plus" size={13} />
            </button>
          </div>

          {/* 筛选（大变更集快速定位） */}
          <div className={"chg-filter" + (filter ? " has" : "")}>
            <TlIcon name="search" size={12} />
            <input
              value={filter}
              placeholder={t("Changes_FilterPlaceholder")}
              spellCheck={false}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setFilter(""); }}
            />
            {filter && (
              <button className="chg-clr" onClick={() => setFilter("")}>
                <TlIcon name="x" size={11} />
              </button>
            )}
          </div>

          <ScrollArea className="file-scroll" style={{ flex: 1 }}>
            {state && (
              <>
                {group("conflicts", t("Changes_Conflicts"), state.conflicts, false, { checkable: false, act: null })}
                {group("staged", t("Changes_StagedGroup"), state.staged, true, { checkable: true, act: "unstage" })}
                {group("changes", t("Changes_ChangesGroup"), state.changes, false, { checkable: true, act: "stage" })}
                {group("unversioned", t("Changes_UnversionedGroup"), state.unversioned, false, { checkable: true, act: "stage" })}
                {allFiles.length === 0 && (
                  <div className="empty-state">
                    {t("Changes_WorktreeClean")}
                    <EmptyHints slot="changes.empty" />
                  </div>
                )}
                {allFiles.length > 0 && q && !allFiles.some((f) => f.path.toLowerCase().includes(q)) && (
                  <div className="chg-noresult">{t("Changes_NoMatch")}</div>
                )}
              </>
            )}
          </ScrollArea>

          {/* 提交框：前缀图标下拉 + AI 生成；底部实时汇总 + 文字主按钮 */}
          <div className="commit-box">
            <div className="prefix-row" ref={prefixRef}
              onKeyDown={(e) => {
                if (!prefixOpen) return;
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const d = e.key === "ArrowDown" ? 1 : -1;
                  setPrefixHi((h) => (h + d + PREFIX_ITEMS.length) % PREFIX_ITEMS.length);
                } else if (e.key === "Enter") {
                  e.preventDefault(); // 菜单开着时 Enter 不回落为触发钮点击
                  if (prefixHi >= 0) insertPrefix(PREFIX_ITEMS[prefixHi].pfx);
                } else if (e.key === "Escape") {
                  setPrefixOpen(false);
                }
              }}>
              <button className="icon-btn" data-tip={t("Changes_PrefixMenu")} aria-haspopup="menu" aria-expanded={prefixOpen}
                onClick={() => { setPrefixOpen((v) => !v); setPrefixHi(-1); }}>
                <TlIcon name="commit" size={13} />
                <TlIcon name="chevron-down" size={9} className="prefix-chev" />
              </button>
              {prefixOpen && (
                <div className="prefix-pop" role="menu" aria-label={t("Changes_PrefixMenu")}>
                  {PREFIX_ITEMS.map((it, i) => (
                    <button key={it.pfx} type="button" role="menuitem" className={"pitem" + (i === prefixHi ? " hi" : "")}
                      onMouseEnter={() => setPrefixHi(i)}
                      onClick={() => insertPrefix(it.pfx)}>
                      <span className="pfx">{it.pfx}</span>
                      <span className="desc">{t(it.descKey)}</span>
                    </button>
                  ))}
                  <div className="pop-hint">{t("Changes_PrefixMenuHint")}</div>
                </div>
              )}
              <span className="grow" style={{ flex: 1 }} />
              <button className="icon-btn" data-tip={aiBusy ? t("Common_Loading") : t("Changes_AiGenerate")} disabled={aiBusy || (state?.staged.length ?? 0) === 0} onClick={() => void generateMessage()}>
                <TlIcon name="sparkle" size={13} />
              </button>
            </div>
            <CommitBlocks fileCount={state?.staged.length ?? 0} />
            <textarea
              ref={commitInputRef}
              placeholder={t("Changes_CommitMessagePlaceholder")}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void doCommit(false); }
              }}
            />
            <div className="commit-actions" style={{ alignItems: "center", justifyContent: "flex-start" }}>
              <span className="chg-sum">
                {t("Changes_CommitStat", commitStat.n)}
                {(commitStat.added > 0 || commitStat.deleted > 0) && (
                  <>
                    {" · "}
                    <span className="diff-stats-add">+{commitStat.added}</span>{" "}
                    <span className="diff-stats-del">−{commitStat.deleted}</span>
                  </>
                )}
              </span>
              <span style={{ flex: 1 }} />
              <button className="tool-btn solid" data-tip={t("Changes_Commit")} disabled={!canCommit} onClick={() => void doCommit(false)}>
                <TlIcon name="check" size={12} />
                {t("Changes_Commit")}
              </button>
              <button className="tool-btn icon" data-tip={t("Changes_CommitAndPush")} disabled={!canCommit} onClick={() => void doCommit(true)}>
                <TlIcon name="up" size={13} />
              </button>
            </div>
          </div>
        </div>} b={
        <div className="split-pane" style={{ display: "flex", flexDirection: "column" }}>
          {selected && (
            <div className="chg-filehead">
              <span className={"status-letter " + (selLetter === "?" ? "st-U" : "st-" + selLetter)}>{selLetter}</span>
              <span className="chg-path" title={selected.path}>
                {selSplit.dir && <><span className="dir">{selSplit.dir}</span><span className="sep">/</span></>}
                <span className="base">{selSplit.base}</span>
              </span>
              {selectedFile?.added != null && (
                <span className="chg-stats">
                  <span className="diff-stats-add">+{selectedFile.added}</span>{" "}
                  <span className="diff-stats-del">−{selectedFile.deleted}</span>
                </span>
              )}
              <span style={{ flex: 1 }} />
              {/* AI 解释 / 审查：针对右侧所选文件（v2 从提交框移入） */}
              <button className="icon-btn" data-tip={t("Changes_AiExplain")} disabled={aiBusy || (state?.staged.length ?? 0) === 0} onClick={() => void explain("explain")}>
                <TlIcon name="chat" size={13} />
              </button>
              <button className="icon-btn" data-tip={t("Changes_AiReview")} disabled={aiBusy || (state?.staged.length ?? 0) === 0} onClick={() => void explain("review")}>
                <TlIcon name="shield" size={13} />
              </button>
              {selected.staged ? (
                <>
                  <button className="tool-btn" disabled={busy}
                    onClick={() => void run(async () => { await call("changes.unstage", { paths: [selected.path] }); setSelected(null); setDiff(null); return t("Changes_Unstaged"); })}>
                    <TlIcon name="down" size={12} />
                    {t("Changes_UnstageFile")}
                  </button>
                  {hasSelectedHunks && (
                    <button className="tool-btn primary" disabled={busy}
                      onClick={() => void run(async () => { await call("changes.unstageHunks", { path: selected.path, indices: [...selectedHunks] }); return t("Changes_UnstagedHunks"); })}>
                      {t("Changes_UnstageHunkSelected", selectedHunks.size)}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button className="tool-btn icon" data-tip={t("Changes_StageFile")} disabled={busy}
                    onClick={() => void run(async () => { await call("changes.stage", { paths: [selected.path] }); setSelected(null); setDiff(null); return t("Changes_Staged"); })}>
                    <TlIcon name="up" size={13} />
                  </button>
                  {hasSelectedHunks && (
                    <button className="tool-btn icon" data-tip={t("Changes_StageHunkSelected", selectedHunks.size)} disabled={busy}
                      onClick={() => void run(async () => { await call("changes.stageHunks", { path: selected.path, indices: [...selectedHunks] }); return t("Changes_StagedHunks"); })}>
                      <TlIcon name="up" size={13} />
                      <span style={{ fontSize: 11 }}>{selectedHunks.size}</span>
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          {selected?.isConflict && (
            <div className="banner">
              <span className="banner-text">{t("Changes_ConflictCompareHint")}</span>
            </div>
          )}
          <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
            {selected && preview ? (
              <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
                <div className="diff-file-header">
                  <span style={{ marginLeft: "auto", color: "var(--c-text3)", fontSize: 11 }}>
                    {preview.fromIndex ? t("Changes_PreviewStaged") : t("Changes_PreviewWorktree")}
                  </span>
                </div>
                <div style={{ flex: 1, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: 12, minHeight: 0 }}>
                  {preview.tooLarge ? (
                    <div className="empty-state">{t("Changes_PreviewTooLarge")}</div>
                  ) : (
                    <img
                      src={`data:${preview.mime};base64,${preview.base64}`}
                      style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                      alt={selected.path}
                    />
                  )}
                </div>
              </div>
            ) : selected && diff ? (
              <DiffView
                diff={diff}
                hideHeader
                focusLine={focusLine}
                inline={app.settings?.diffMode === "inline"}
                selectedHunks={selected.staged || selected.isNew ? undefined : selectedHunks}
                onToggleHunk={selected.staged || selected.isNew ? undefined : toggleHunk}
                hunkActionLabel={hunkActionLabel}
                onHunkAction={selected.staged ? hunkAction : selected.isNew ? undefined : hunkAction}
              />
            ) : (
              <div className="empty-state">{t("Changes_SelectFileHint")}</div>
            )}
          </div>
        </div>} />
      </div>

      {explainText && (
        <Modal title={explainText.title} confirmText={t("Common_Close")} onClose={() => setExplainText(null)} onConfirm={() => setExplainText(null)}>
          <div style={{ whiteSpace: "pre-wrap", maxHeight: 340, overflow: "auto", userSelect: "text", fontSize: 12.5, lineHeight: 1.5 }}>
            {explainText.text}
          </div>
        </Modal>
      )}
      {createBranch !== null && (
        <Modal
          title={t("Branches_CreateTitle")}
          confirmText={t("Common_Create")}
          onClose={() => setCreateBranch(null)}
          onConfirm={async () => {
            await run(async () => { await call("branches.create", { name: createBranch.trim() }); return t("Branches_Created"); });
            setCreateBranch(null);
          }}
        >
          <input
            className="input"
            style={{ width: "100%" }}
            autoFocus
            placeholder={t("Branches_NamePlaceholder")}
            value={createBranch}
            onChange={(e) => setCreateBranch(e.target.value)}
          />
        </Modal>
      )}
      {menuElement}
    </>
  );
}

/** 状态徽标字母：优先 git 原生 code（staged=index 位 / changes=worktree 位 / untracked ? / 冲突 XY），
 * 旧数据无 code 时按 category 兜底。 */
function letterOf(f: FileStatusDTO): string {
  if (f.isConflict) return "U";
  if (f.code) return f.code[0];
  if (f.category === "unversioned") return "?";
  if (f.category === "staged") return "A";
  return "M";
}

/** 路径分层：目录段（淡显、左截断）+ 文件名（全亮）。 */
function splitPath(p: string): { dir: string; base: string } {
  const i = p.lastIndexOf("/");
  return i < 0 ? { dir: "", base: p } : { dir: p.slice(0, i), base: p.slice(i + 1) };
}

/** 提交对话框区块接缝（E 阶段收尾：L2 数据供给，只能提示不能阻断——阻断走门禁）。 */
function useCommitBlocks(fileCount: number) {
  const [blocks, setBlocks] = useState<{ packageId: string; text: string }[]>([]);
  useEffect(() => {
    void call<{ packageId: string; text: string }[]>("ui.commitBlocks", { fileCount, message: "" }).then(setBlocks);
  }, [fileCount]);
  return blocks;
}

function CommitBlocks({ fileCount }: { fileCount: number }) {
  const blocks = useCommitBlocks(fileCount);
  if (blocks.length === 0) return null;
  return (
    <div className="hint" style={{ whiteSpace: "pre-wrap" }}>
      {blocks.map((b, i) => (
        <div key={i}>▸ {b.text}<span className="hint">（{b.packageId}）</span></div>
      ))}
    </div>
  );
}

/** 空状态提示接缝（emptyHints L1 数据包，extension-system-v2.md §16.6 E 阶段收尾）。 */
function EmptyHints({ slot }: { slot: "changes.empty" | "log.empty" | "branches.empty" }) {
  const [hints, setHints] = useState<string[]>([]);
  useEffect(() => {
    void call<{ packageId: string; text: string }[]>("ui.emptyHints", { slot }).then((r) => setHints(r.map((x) => x.text)));
  }, [slot]);
  if (hints.length === 0) return null;
  return <div className="hint" style={{ marginTop: 6 }}>{hints.join("  ·  ")}</div>;
}

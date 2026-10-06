import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pageSdk, useAppState } from "../pageSdk";
import { seamMenuItems } from "../commands";
import { Banner, DiffView, Modal, SplitPane, SyncBar, useSyncProgress, useContextMenu, type CtxMenuItem } from "../kit";
import type { ChangesStateDTO, DiffDTO, FileStatusDTO } from "../bridge/types";

// R1 宿主面收敛：本页只经 pageSdk 消费宿主（ui-full-pluginization-plan.md R1）
const { call, t, navigate, refresh: refreshCurrent, openSettings, setContext: setSharedContext } = pageSdk;
const useApp = useAppState;

const PREFIXES = ["feat:", "fix:", "docs:", "test:", "build:", "chore:"];

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

  useEffect(() => {
    if (!repo) { setStateDto(null); return; }
    void reload();
    setSelected(null);
    setDiff(null);
    setMessage("");
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
      await reload();
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

  const select = (f: FileStatusDTO, stagedView: boolean) => {
    const sel = { path: f.path, staged: stagedView, isNew: f.category === "unversioned", isConflict: f.isConflict };
    setSelected(sel);
    void loadDiff(sel);
  };

  const toggleCheck = (path: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const allFiles = useMemo(
    () => (state ? [...state.staged, ...state.changes, ...state.unversioned, ...state.conflicts] : []),
    [state],
  );

  const stagedPaths = useMemo(
    () => allFiles.filter((f) => checked.has(f.path) && f.category !== "staged" && f.category !== "conflicts").map((f) => f.path),
    [allFiles, checked],
  );
  const unstagedPaths = useMemo(
    () => allFiles.filter((f) => !checked.has(f.path) && f.category === "staged").map((f) => f.path),
    [allFiles, checked],
  );
  const canCommit = !!state && (state.staged.length > 0 || stagedPaths.length > 0) && message.trim().length > 0 && !busy;

  const doCommit = async (push: boolean) => {
    if (!canCommit) return;
    setBusy(true);
    try {
      const r = await call<{ sha: string | null; pushError: string | null }>("changes.commit", {
        message: message.trim(),
        push,
        toStage: stagedPaths,
        toUnstage: unstagedPaths,
      });
      setMessage("");
      setChecked(new Set());
      if (r.pushError) {
        setError(t("Changes_PushFailed", r.pushError));
        setErrorDetail(null);
      } else {
        showTransient(push ? t("Changes_CommittedAndPushed") : t("Changes_Committed"));
      }
      await reload();
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
        await reload();
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
        await reload();
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

  const group = (gkey: string, title: string, files: FileStatusDTO[], stagedView: boolean, allowCheck: boolean) => {
    if (files.length === 0) return null;
    const eligible = files.filter((f) => !f.isConflict);
    const allChecked = allowCheck && eligible.length > 0 && eligible.every((f) => checked.has(f.path));
    const someChecked = eligible.some((f) => checked.has(f.path));
    // 勾选（含组头全选）后可一键批量暂存，无需逐个右键
    const checkedPaths = eligible.filter((f) => checked.has(f.path)).map((f) => f.path);
    const toggleAll = () =>
      setChecked((prev) => {
        const next = new Set(prev);
        for (const f of eligible) {
          if (allChecked) next.delete(f.path);
          else next.add(f.path);
        }
        return next;
      });
    const collapsed = collapsedGroups.has(gkey);
    return (
      <div>
        <div className="group-header" style={{ cursor: "pointer", userSelect: "none" }} onClick={() => toggleGroup(gkey)}>
          {allowCheck && eligible.length > 0 && (
            <input
              type="checkbox"
              checked={allChecked}
              ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked; }}
              onChange={toggleAll}
              onClick={(e) => e.stopPropagation()}
              title={allChecked ? t("Changes_UncheckAll") : t("Changes_CheckAll")}
            />
          )}
          <span style={{ width: 12, color: "var(--c-text3)", fontSize: 10 }}>{collapsed ? "▸" : "▾"}</span>
          <span>{title}</span>
          <span style={{ color: "var(--c-text3)", fontWeight: 400 }}>{files.length}</span>
          <span className="grow" style={{ flex: 1 }} />
          {!stagedView && someChecked && (
            <button
              className="tool-btn icon sm"
              data-tip={t("Changes_StageChecked", checkedPaths.length)}
              style={{ width: 22, height: 20 }}
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                void run(async () => { await call("changes.stage", { paths: checkedPaths }); return t("Changes_Staged"); });
              }}
            >
              <span className="glyph" style={{ fontSize: 11 }}>{""}</span>
            </button>
          )}
        </div>
        {!collapsed && files.map((f) => (
          <div
            key={f.category + f.path}
            className={"list-row" + (selected?.path === f.path && selected?.staged === stagedView ? " selected" : "")}
            onClick={() => select(f, stagedView)}
            onContextMenu={(e) => {
              // menus 接缝（extension-system-v2.md §16.5）：本地动作 + 内置文件菜单（走接缝） + 包菜单
              void (async () => {
                const local: CtxMenuItem[] = [
                  stagedView
                    ? { label: t("Changes_UnstageFile"), action: () => void run(async () => { await call("changes.unstage", { paths: [f.path] }); return t("Changes_Unstaged"); }) }
                    : { label: t("Changes_StageFile"), action: () => void run(async () => { await call("changes.stage", { paths: [f.path] }); return t("Changes_Staged"); }) },
                  ...(f.isConflict ? [{ label: t("Changes_MarkResolved"), action: () => void run(async () => { await call("changes.stage", { paths: [f.path] }); return t("Changes_MarkedResolved"); }) }] : []),
                  { sep: true, label: "", action: () => {} },
                ];
                showMenu(e, [...local, ...(await seamMenuItems("changesFile", f.path))]);
              })();
            }}
          >
            {allowCheck && !f.isConflict && (
              <input type="checkbox" checked={checked.has(f.path)} onChange={() => toggleCheck(f.path)} />
            )}
            <span className={"status-letter st-" + statusLetter(f)}>{statusLetter(f)}</span>
            <span className="trim" style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 12 }}>{f.path}</span>
            {f.added !== null && <span className="diff-stats-add">+{f.added}</span>}
            {f.deleted !== null && <span className="diff-stats-del">−{f.deleted}</span>}
          </div>
        ))}
      </div>
    );
  };

  const hasSelectedHunks = selectedHunks.size > 0 && diff && !diff.isBinary;

  return (
    <>
      <div className="toolbar">
        <button className="tool-btn icon" data-tip="抓取" disabled={!repo || busy} onClick={() => void run(async () => { await call("changes.fetch", {}); return t("Changes_Fetched"); })}>
          <span className="glyph">{""}</span>
        </button>
        <button className="tool-btn icon" data-tip="拉取" disabled={!repo || busy} onClick={() => void run(async () => { await call("changes.pull", { rebase: false }); return t("Changes_Pulled"); })}>
          <span className="glyph">{""}</span>
        </button>
        <button className="tool-btn icon" data-tip="拉取（变基）" disabled={!repo || busy} onClick={() => void run(async () => { await call("changes.pull", { rebase: true }); return t("Changes_PulledRebase"); })}>
          <span className="glyph">{""}</span>
        </button>
        <button className="tool-btn icon" data-tip="推送" disabled={!repo || busy} onClick={() => void doPush()}>
          <span className="glyph">{""}</span>
        </button>
        <span className="grow" />
        <button className="tool-btn icon" data-tip="创建分支" onClick={() => setCreateBranch("")}>
          <span className="glyph">{""}</span>
        </button>
      </div>

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
        <div className="split-pane" style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, overflow: "auto" }}>
            {state && (
              <>
                {group("conflicts", t("Changes_Conflicts"), state.conflicts, false, false)}
                {group("staged", t("Changes_StagedGroup"), state.staged, true, true)}
                {group("changes", t("Changes_ChangesGroup"), state.changes, false, true)}
                {group("unversioned", t("Changes_UnversionedGroup"), state.unversioned, false, true)}
                {allFiles.length === 0 && (
                  <div className="empty-state">
                    {t("Changes_WorktreeClean")}
                    <EmptyHints slot="changes.empty" />
                  </div>
                )}
              </>
            )}
          </div>

          <div className="commit-box">
            <div className="prefix-row">
              {PREFIXES.map((p) => (
                <button key={p} className="prefix-chip" onClick={() => setMessage((m) => (m.trim() ? m : p + " "))}>{p}</button>
              ))}
              <span className="grow" style={{ flex: 1 }} />
              <button className="tool-btn icon" data-tip={aiBusy ? t("Common_Loading") : t("Changes_AiGenerate")} disabled={aiBusy || (state?.staged.length ?? 0) === 0} onClick={() => void generateMessage()}>
                <span className="glyph">{""}</span>
              </button>
              <button className="tool-btn icon" data-tip={t("Changes_AiExplain")} disabled={aiBusy || (state?.staged.length ?? 0) === 0} onClick={() => void explain("explain")}>
                <span className="glyph">{""}</span>
              </button>
              <button className="tool-btn icon" data-tip={t("Changes_AiReview")} disabled={aiBusy || (state?.staged.length ?? 0) === 0} onClick={() => void explain("review")}>
                <span className="glyph">{""}</span>
              </button>
            </div>
            <CommitBlocks fileCount={state?.staged.length ?? 0} />
            <textarea
              placeholder={t("Changes_CommitMessagePlaceholder")}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void doCommit(false); }
              }}
            />
            <div className="commit-actions">
              <button className="tool-btn primary icon" data-tip={t("Changes_Commit")} disabled={!canCommit} onClick={() => void doCommit(false)}>
                <span className="glyph">{""}</span>
              </button>
              <button className="tool-btn icon" data-tip={t("Changes_CommitAndPush")} disabled={!canCommit} onClick={() => void doCommit(true)}>
                <span className="glyph">{""}</span>
              </button>
            </div>
          </div>
        </div>} b={
        <div className="split-pane" style={{ display: "flex", flexDirection: "column" }}>
          {selected && (
            <div className="toolbar" style={{ borderBottom: "none" }}>
              {selected.staged ? (
                <>
                  <button
                    className="tool-btn"
                    disabled={busy}
                    onClick={() => void run(async () => { await call("changes.unstage", { paths: [selected.path] }); setSelected(null); setDiff(null); return t("Changes_Unstaged"); })}
                  >
                    {t("Changes_UnstageFile")}
                  </button>
                  {hasSelectedHunks && (
                    <button
                      className="tool-btn primary"
                      disabled={busy}
                      onClick={() => void run(async () => { await call("changes.unstageHunks", { path: selected.path, indices: [...selectedHunks] }); return t("Changes_UnstagedHunks"); })}
                    >
                      {t("Changes_UnstageHunkSelected", selectedHunks.size)}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    className="tool-btn primary icon"
                    data-tip={t("Changes_StageFile")}
                    disabled={busy}
                    onClick={() => void run(async () => { await call("changes.stage", { paths: [selected.path] }); setSelected(null); setDiff(null); return t("Changes_Staged"); })}
                  >
                    <span className="glyph">{""}</span>
                  </button>
                  {hasSelectedHunks && (
                    <button
                      className="tool-btn primary icon"
                      data-tip={t("Changes_StageHunkSelected", selectedHunks.size)}
                      disabled={busy}
                      onClick={() => void run(async () => { await call("changes.stageHunks", { path: selected.path, indices: [...selectedHunks] }); return t("Changes_StagedHunks"); })}
                    >
                      <span className="glyph">{""}</span>
                    </button>
                  )}
                </>
              )}
              <span className="grow" />
              <button className="tool-btn icon" data-tip={t("Changes_OpenInEditor")} onClick={() => void call("shell.openPath", { path: selected.path, editor: true })}>
                <span className="glyph">{""}</span>
              </button>
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
                  <span className="path">{selected.path}</span>
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
                focusLine={focusLine}
                inline={app.settings?.diffMode === "inline"}
                selectedHunks={selected.staged || selected.isNew ? undefined : selectedHunks}
                onToggleHunk={selected.staged || selected.isNew ? undefined : (i) =>
                  setSelectedHunks((prev) => {
                    const next = new Set(prev);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    return next;
                  })
                }
                hunkActionLabel={() => (selected.staged ? t("Changes_UnstageHunk") : t("Changes_StageHunk"))}
                onHunkAction={
                  selected.staged
                    ? (i) => void run(async () => { await call("changes.unstageHunks", { path: selected.path, indices: [i] }); return t("Changes_UnstagedHunks"); })
                    : selected.isNew
                      ? undefined
                      : (i) => void run(async () => { await call("changes.stageHunks", { path: selected.path, indices: [i] }); return t("Changes_StagedHunks"); })
                }
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
            refreshCurrent();
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

function statusLetter(f: FileStatusDTO): string {
  if (f.isConflict) return "U";
  if (f.category === "unversioned") return "U";
  if (f.category === "staged") return "A";
  return "M";
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

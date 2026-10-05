import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { call } from "../bridge/client";
import { Banner, Modal, useContextMenu } from "../components/Dialogs";
import { DiffView } from "../components/DiffView";
import { SplitPane } from "../components/SplitPane";
import type { ChangesStateDTO, DiffDTO, FileStatusDTO } from "../bridge/types";
import { refreshCurrent, openSettings, t, useApp } from "../state/store";

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
  const [selected, setSelected] = useState<{ path: string; staged: boolean; isNew: boolean } | null>(null);
  const [diff, setDiff] = useState<DiffDTO | null>(null);
  const [preview, setPreview] = useState<PreviewDTO | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [selectedHunks, setSelectedHunks] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [findings, setFindings] = useState<SafetyFindingDTO[]>([]);
  const [feedback, setFeedback] = useState<AgentFeedbackDTO | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [explainText, setExplainText] = useState<{ title: string; text: string } | null>(null);
  const [createBranch, setCreateBranch] = useState<string | null>(null);
  const [pushErrorKind, setPushErrorKind] = useState<string | null>(null);
  const { showMenu, menuElement } = useContextMenu();
  const transientTimer = useRef<number | null>(null);

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
      setBusy(false);
    }
  };

  const loadDiff = useCallback(async (sel: { path: string; staged: boolean; isNew: boolean }) => {
    // 图片等可预览二进制：直接出内容，不请求 diff
    setPreview(null);
    if (previewable(sel.path)) {
      try {
        const p = await call<PreviewDTO>("file.preview", { path: sel.path, staged: sel.staged });
        setPreview(p);
        setDiff(null);
        setSelectedHunks(new Set());
        return;
      } catch {
        // 读取失败（文件消失等）→ 回退 diff 路径
      }
    }
    try {
      const d = await call<DiffDTO>("changes.diffFile", { path: sel.path, staged: sel.staged, isNewFile: sel.isNew });
      setDiff(d);
      setSelectedHunks(new Set());
    } catch (e) {
      setDiff(null);
      setError((e as Error).message);
    }
  }, []);

  const select = (f: FileStatusDTO, stagedView: boolean) => {
    const sel = { path: f.path, staged: stagedView, isNew: f.category === "unversioned" };
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

  const group = (title: string, files: FileStatusDTO[], stagedView: boolean, allowCheck: boolean) =>
    files.length > 0 && (
      <div>
        <div className="group-header">
          <span>{title}</span>
          <span style={{ color: "var(--c-text3)", fontWeight: 400 }}>{files.length}</span>
          {allowCheck && (
            <span className="grow" style={{ flex: 1 }} />
          )}
        </div>
        {files.map((f) => (
          <div
            key={f.category + f.path}
            className={"list-row" + (selected?.path === f.path && selected?.staged === stagedView ? " selected" : "")}
            onClick={() => select(f, stagedView)}
            onContextMenu={(e) =>
              showMenu(e, [
                stagedView
                  ? { label: t("Changes_UnstageFile"), action: () => void run(async () => { await call("changes.unstage", { paths: [f.path] }); return t("Changes_Unstaged"); }) }
                  : { label: t("Changes_StageFile"), action: () => void run(async () => { await call("changes.stage", { paths: [f.path] }); return t("Changes_Staged"); }) },
                ...(f.isConflict ? [{ label: t("Changes_MarkResolved"), action: () => void run(async () => { await call("changes.stage", { paths: [f.path] }); return t("Changes_MarkedResolved"); }) }] : []),
                { sep: true, label: "", action: () => {} },
                { label: t("Changes_OpenInEditor"), action: () => void call("shell.openPath", { path: f.path, editor: true }) },
                { label: t("Changes_RevealInExplorer"), action: () => void call("shell.reveal", { path: f.path }) },
              ])
            }
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

  const hasSelectedHunks = selectedHunks.size > 0 && diff && !diff.isBinary;

  return (
    <>
      <div className="toolbar">
        <button className="tool-btn" disabled={!repo || busy} onClick={() => void run(async () => { await call("changes.fetch", {}); return t("Changes_Fetched"); })}>
          {t("Changes_Fetch")}
        </button>
        <button className="tool-btn" disabled={!repo || busy} onClick={() => void run(async () => { await call("changes.pull", { rebase: false }); return t("Changes_Pulled"); })}>
          {t("Changes_Pull")}
        </button>
        <button className="tool-btn" disabled={!repo || busy} onClick={() => void run(async () => { await call("changes.pull", { rebase: true }); return t("Changes_PulledRebase"); })}>
          {t("Changes_PullRebase")}
        </button>
        <button className="tool-btn" disabled={!repo || busy} onClick={() => void doPush()}>
          {t("Changes_Push")}
        </button>
        <span className="grow" />
        <button className="tool-btn" onClick={() => setCreateBranch("")}>{t("Branches_Create")}</button>
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
      {feedback && (
        <Banner
          text={t("Changes_AgentFeedback", feedback.note)}
          detail={feedback.path ?? undefined}
          onClose={async () => { await call("changes.clearFeedback", {}); setFeedback(null); }}
        />
      )}
      {findings.length > 0 && (
        <div
          className={"banner" + (findings.some((f) => f.severity === "blocked") ? " error" : "")}
          style={{ flexDirection: "column", alignItems: "stretch", gap: 2 }}
        >
          {findings.slice(0, 6).map((f, i) => (
            <div key={i} className="banner-text">
              {f.severity === "blocked" ? "⛔" : "⚠️"} <span style={{ fontFamily: "var(--mono)" }}>{f.filePath}{f.line ? `:${f.line}` : ""}</span> — {f.message}
            </div>
          ))}
          {findings.length > 6 && <div className="banner-text" style={{ color: "var(--c-text2)" }}>{t("Changes_MoreFindings", findings.length - 6)}</div>}
        </div>
      )}

      <SplitPane settingKey="changesSplitterFraction" initial={0.38} a={
        <div className="split-pane" style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, overflow: "auto" }}>
            {state && (
              <>
                {group(t("Changes_Conflicts"), state.conflicts, false, false)}
                {group(t("Changes_StagedGroup"), state.staged, true, true)}
                {group(t("Changes_ChangesGroup"), state.changes, false, true)}
                {group(t("Changes_UnversionedGroup"), state.unversioned, false, true)}
                {allFiles.length === 0 && <div className="empty-state">{t("Changes_WorktreeClean")}</div>}
              </>
            )}
          </div>

          <div className="commit-box">
            <div className="prefix-row">
              {PREFIXES.map((p) => (
                <button key={p} className="prefix-chip" onClick={() => setMessage((m) => (m.trim() ? m : p + " "))}>{p}</button>
              ))}
              <span className="grow" style={{ flex: 1 }} />
              <button className="tool-btn" disabled={aiBusy || (state?.staged.length ?? 0) === 0} onClick={() => void generateMessage()}>
                {aiBusy ? t("Common_Loading") : t("Changes_AiGenerate")}
              </button>
              <button className="tool-btn" disabled={aiBusy || (state?.staged.length ?? 0) === 0} onClick={() => void explain("explain")}>
                {t("Changes_AiExplain")}
              </button>
              <button className="tool-btn" disabled={aiBusy || (state?.staged.length ?? 0) === 0} onClick={() => void explain("review")}>
                {t("Changes_AiReview")}
              </button>
            </div>
            <textarea
              placeholder={t("Changes_CommitMessagePlaceholder")}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void doCommit(false); }
              }}
            />
            <div className="commit-actions">
              <button className="tool-btn primary" disabled={!canCommit} onClick={() => void doCommit(false)}>
                {t("Changes_Commit")}
              </button>
              <button className="tool-btn" disabled={!canCommit} onClick={() => void doCommit(true)}>
                {t("Changes_CommitAndPush")}
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
                    className="tool-btn primary"
                    disabled={busy}
                    onClick={() => void run(async () => { await call("changes.stage", { paths: [selected.path] }); setSelected(null); setDiff(null); return t("Changes_Staged"); })}
                  >
                    {t("Changes_StageFile")}
                  </button>
                  {hasSelectedHunks && (
                    <button
                      className="tool-btn primary"
                      disabled={busy}
                      onClick={() => void run(async () => { await call("changes.stageHunks", { path: selected.path, indices: [...selectedHunks] }); return t("Changes_StagedHunks"); })}
                    >
                      {t("Changes_StageHunkSelected", selectedHunks.size)}
                    </button>
                  )}
                </>
              )}
              <span className="grow" />
              <button className="tool-btn" onClick={() => void call("shell.openPath", { path: selected.path, editor: true })}>
                {t("Changes_OpenInEditor")}
              </button>
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

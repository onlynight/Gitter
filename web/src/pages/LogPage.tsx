import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { pageSdk, useAppState } from "../pageSdk";
import { seamMenuItems } from "../commands";
import { Banner, DiffView, Modal, SplitPane, useContextMenu, type CtxMenuItem } from "../kit";
import type { CommitDTO, CommitDetailDTO, DiffDTO, FileMetaDTO } from "../bridge/types";
import { groupSessions, squashMessage, type AgentSession } from "../lib/sessions";

// R1 宿主面收敛：本页只经 pageSdk 消费宿主（ui-full-pluginization-plan.md R1）
const { call, t, navigate, refresh: refreshCurrent, setContext: setSharedContext, focusTask } = pageSdk;
const useApp = useAppState;

// ---- 行模型（对齐 LogRow：按天组头 / 会话卡 / 提交行）----

type Row =
  | { kind: "group"; key: string; title: string; count: number; collapsed: boolean }
  | { kind: "session"; key: string; session: AgentSession; collapsed: boolean }
  | { kind: "commit"; key: string; commit: CommitDTO; selected: boolean; meta: string; ai?: string };

function dayTitle(day: Date): string {
  const today = new Date();
  const isSameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yest = new Date(today.getTime() - 86400000);
  if (isSameDay(day, today)) return t("Log_Today");
  if (isSameDay(day, yest)) return t("Log_Yesterday");
  return day.toLocaleDateString();
}

function relativeTime(unix: number): string {
  const diff = Date.now() / 1000 - unix;
  if (diff < 60) return t("Log_JustNow");
  if (diff < 3600) return t("Log_MinutesAgo", Math.floor(diff / 60));
  if (diff < 86400) return t("Log_HoursAgo", Math.floor(diff / 3600));
  if (diff < 86400 * 30) return t("Log_DaysAgo", Math.floor(diff / 86400));
  return new Date(unix * 1000).toLocaleDateString();
}

export function LogPage() {
  const app = useApp();
  const repo = app.repo;
  const [commits, setCommits] = useState<CommitDTO[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<{ current: string | null; names: string[] }>({ current: null, names: [] });
  const [branch, setBranch] = useState<string>("");
  const [query, setQuery] = useState("");
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  const [collapsedSessions, setCollapsedSessions] = useState<Set<string>>(new Set());
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  // U1b 共享上下文镜像
  useEffect(() => {
    setSharedContext({ selectedCommitSha: selectedSha });
  }, [selectedSha]);
  const [detail, setDetail] = useState<CommitDetailDTO | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [fileDiff, setFileDiff] = useState<DiffDTO | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [compareBase, setCompareBase] = useState<CommitDTO | null>(null);
  // 重置分支对话框（Android Studio 语义：soft/mixed/hard）
  const [resetTarget, setResetTarget] = useState<CommitDTO | null>(null);
  const [resetMode, setResetMode] = useState<"soft" | "mixed" | "hard">("mixed");
  const { showMenu, menuElement } = useContextMenu();
  const listRef = useRef<HTMLDivElement>(null);

  const loadPage = useCallback(
    async (skip: number, replace: boolean) => {
      if (!repo) return;
      setLoading(true);
      setError(null);
      try {
        const r = await call<{ commits: CommitDTO[]; hasMore: boolean }>("log.query", {
          branch: branch || undefined,
          query: query || undefined,
          limit: 50,
          skip,
        });
        setCommits((prev) => (replace ? r.commits : [...prev, ...r.commits]));
        setHasMore(r.hasMore);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [repo, branch, query],
  );

  const loadBranches = useCallback(async () => {
    if (!repo) return;
    try {
      const b = await call<{ current: string | null; names: string[] }>("log.branches");
      setBranches(b);
      setBranch((cur) => cur || b.current || "");
    } catch {
      // 仓库刚切换的竞态：下次刷新自愈
    }
  }, [repo]);

  // 首次 / 仓库切换 / F5 / 分支与搜索变化 → 重置加载
  useEffect(() => {
    if (!repo) { setCommits([]); setDetail(null); return; }
    void loadBranches();
    setSelectedSha(null);
    setDetail(null);
    setFileDiff(null);
    setCompareBase(null);
  }, [repo, app.refreshTick]);

  useEffect(() => {
    if (!repo) return;
    const timer = setTimeout(() => void loadPage(0, true), 200); // 搜索防抖
    return () => clearTimeout(timer);
  }, [repo, branch, query, app.refreshTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // 详情加载（含比较基准语义：log.select 的 base..sha 树 diff）
  useEffect(() => {
    if (!repo || !selectedSha) { setDetail(null); return; }
    setFileDiff(null);
    setDetailError(null);
    (async () => {
      try {
        const d = await call<CommitDetailDTO>("log.detail", { sha: selectedSha, baseSha: compareBase?.sha });
        setDetail(d);
      } catch (e) {
        setDetailError((e as Error).message);
        setDetail(null);
      }
    })();
  }, [repo, selectedSha, compareBase]);

  const rows: Row[] = useMemo(() => {
    const sessions = groupSessions(commits);
    const sessionOfSha = new Map<string, AgentSession>();
    const sessionHeadSha = new Set<string>();
    for (const s of sessions) {
      for (const c of s.commits) sessionOfSha.set(c.sha, s);
      sessionHeadSha.add(s.commits[0].sha);
    }
    const emittedSessions = new Set<string>();

    const out: Row[] = [];
    let curDay = "";
    let count = 0;
    const pushGroup = () => {
      if (curDay) {
        out.push({
          kind: "group",
          key: curDay,
          title: dayTitle(new Date(curDay)),
          count,
          collapsed: collapsedDays.has(curDay),
        });
      }
    };
    for (const c of commits) {
      const day = new Date(c.committerDate * 1000).toISOString().slice(0, 10);
      if (day !== curDay) { pushGroup(); curDay = day; count = 0; }
      count++;

      const session = sessionOfSha.get(c.sha);
      if (session) {
        // 会话成员：只在头部位置插卡；折叠时成员行不出现
        if (sessionHeadSha.has(c.sha) && !emittedSessions.has(session.sessionId)) {
          emittedSessions.add(session.sessionId);
          out.push({
            kind: "session",
            key: "sess-" + session.sessionId,
            session,
            collapsed: collapsedSessions.has(session.sessionId),
          });
        }
        if (collapsedSessions.has(session.sessionId)) continue;
      }

      out.push({
        kind: "commit",
        key: c.sha,
        commit: c,
        selected: c.sha === selectedSha,
        meta: `${c.author} · ${relativeTime(c.committerDate)}`,
        ai: c.assistedBy[0],
      });
    }
    pushGroup();
    return out;
  }, [commits, collapsedDays, collapsedSessions, selectedSha]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: (i) => (rows[i].kind === "group" ? 26 : rows[i].kind === "session" ? 34 : 44),
    overscan: 12,
  });

  // 接近底部增量加载
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      if (hasMore && !loading && el.scrollTop + el.clientHeight > el.scrollHeight - 300) {
        void loadPage(commits.length, false);
      }
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [hasMore, loading, commits.length, loadPage]);

  const copy = (text: string) => navigator.clipboard.writeText(text);

  const squash = async (s: AgentSession) => {
    try {
      await call("log.squash", {
        topSha: s.commits[0].sha,
        bottomParentSha: s.commits[s.commits.length - 1].sha,
        message: squashMessage(s),
      });
      setError(null);
      refreshCurrent();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const doReset = async () => {
    if (!resetTarget) return;
    try {
      await call("log.reset", { sha: resetTarget.sha, mode: resetMode });
      setError(null);
      setResetTarget(null);
      refreshCurrent();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!repo) {
    return <div className="empty-state"><div className="big">⏱</div>{t("Common_NoProjectSelected")}</div>;
  }

  return (
    <>
      <div className="toolbar">
        <select
          className="input"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          title={t("Log_BranchFilter")}
        >
          {[...new Set([branches.current ?? "", ...branches.names])].filter(Boolean).map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <input
          className="input"
          style={{ width: 220 }}
          placeholder={t("Log_SearchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="grow" />
        {loading && <span className="spinner">{t("Common_Loading")}</span>}
      </div>

      {error && <Banner text={error} error onClose={() => setError(null)} />}
      {compareBase && detail && (
        <Banner
          text={t("Log_ComparingWith", compareBase.shortSha)}
          onClose={() => setCompareBase(null)}
        />
      )}

      <SplitPane settingKey="logSplitterFraction" initial={0.42} a={
        <div className="split-pane" ref={listRef}>
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const row = rows[vi.index];
              if (row.kind === "group") {
                return (
                  <div
                    key={row.key}
                    className="group-header"
                    style={{ position: "absolute", top: vi.start, left: 0, right: 0, height: vi.size }}
                    onClick={() =>
                      setCollapsedDays((prev) => {
                        const next = new Set(prev);
                        if (next.has(row.key)) next.delete(row.key);
                        else next.add(row.key);
                        return next;
                      })
                    }
                  >
                    <span>{row.collapsed ? "▸" : "▾"}</span>
                    <span>{row.title}</span>
                    <span style={{ color: "var(--c-text3)", fontWeight: 400 }}>{row.count}</span>
                  </div>
                );
              }
              if (row.kind === "session") {
                const s = row.session;
                return (
                  <div
                    key={row.key}
                    className="list-row session-card"
                    style={{ position: "absolute", top: vi.start, left: 0, right: 0, height: vi.size, background: "var(--c-chip-purple-bg)" }}
                    onClick={() =>
                      setCollapsedSessions((prev) => {
                        const next = new Set(prev);
                        if (next.has(s.sessionId)) next.delete(s.sessionId);
                        else next.add(s.sessionId);
                        return next;
                      })
                    }
                    onContextMenu={(e) =>
                      showMenu(e, [
                        {
                          label: t("Log_SquashSession", s.commits.length),
                          action: () => void squash(s),
                        },
                        { label: t("Log_CopyAgent"), action: () => copy(s.agentId) },
                        { label: t("Log_OpenTaskCard"), action: () => { focusTask(s.agentId); navigate("tasks"); } },
                      ])
                    }
                  >
                    <span>{row.collapsed ? "▸" : "▾"}</span>
                    <span className="badge" style={{ background: "var(--c-chip-purple-bg)", color: "var(--c-chip-purple-fg)" }}>AI · {s.agentId}</span>
                    <span className="trim" style={{ flex: 1, fontWeight: 600 }}>{s.commits[0].subject}</span>
                    <span className="mono">{s.commits.length} checkpoints</span>
                  </div>
                );
              }
              const c = row.commit;
              return (
                <div
                  key={row.key}
                  className={"list-row" + (row.selected ? " selected" : "")}
                  style={{ position: "absolute", top: vi.start, left: 0, right: 0, height: vi.size }}
                  onClick={() => setSelectedSha(c.sha)}
                  onContextMenu={(e) => {
                    // menus 接缝：本地动作 + 包贡献项（logRow）
                    void (async () => {
                      const local: CtxMenuItem[] = [
                        { label: t("Log_CopySha"), action: () => copy(c.sha) },
                        { label: t("Log_CopySubject"), action: () => copy(c.subject) },
                        { label: t("Log_CopyAuthor"), action: () => copy(c.author) },
                        { sep: true, label: "", action: () => {} },
                        {
                          label: t("Log_CompareWithSelected"),
                          action: () => setCompareBase((cur) => (cur?.sha === c.sha ? null : c)),
                        },
                        { label: t("Log_ResetToHere"), action: () => { setResetMode("mixed"); setResetTarget(c); } },
                      ];
                      showMenu(e, [...local, ...(await seamMenuItems("logRow"))]);
                    })();
                  }}
                >
                  <span className="mono">{c.shortSha}</span>
                  <span className="trim" style={{ flex: 1 }}>{c.subject}</span>
                  {c.refs.slice(0, 3).map((r) => (
                    <span key={r.name} className={"badge" + (r.isTag ? " tag" : "")}>{r.name}</span>
                  ))}
                  {row.ai && <span className="badge tag">AI · {row.ai}</span>}
                  <span className="trim" style={{ color: "var(--c-text3)", fontSize: 11, maxWidth: 180 }}>{row.meta}</span>
                </div>
              );
            })}
          </div>
          {hasMore && !loading && <div className="spinner">{t("Log_LoadMoreHint")}</div>}
        </div>} b={
        <div className="split-pane" style={{ display: "flex", flexDirection: "column" }}>
          {detail ? (
            <>
              <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--c-border)" }}>
                <div style={{ fontSize: 14, fontWeight: 600, userSelect: "text" }}>{detail.commit.subject}</div>
                <div style={{ fontSize: 11, color: "var(--c-text2)", marginTop: 4, userSelect: "text" }}>
                  {detail.commit.author} &lt;{detail.commit.authorEmail}&gt; · {new Date(detail.commit.authorDate * 1000).toLocaleString()} · {detail.commit.shortSha}
                </div>
                {detail.commit.body.trim() && (
                  <div style={{ fontSize: 12, color: "var(--c-text2)", marginTop: 6, whiteSpace: "pre-wrap", userSelect: "text" }}>{detail.commit.body.trim()}</div>
                )}
              </div>
              <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
                {detail.files.length === 0 && <div className="empty-state">{t("Log_NoFiles")}</div>}
                {detail.files.map((f: FileMetaDTO) => (
                  <FileRow
                    key={f.path}
                    file={f}
                    active={fileDiff?.path === f.path}
                    onOpen={async () => {
                      setDiffLoading(true);
                      try {
                        const d = await call<DiffDTO>("log.fileDiff", { sha: detail.commit.sha, baseSha: compareBase?.sha, path: f.path });
                        setFileDiff(d);
                      } catch (e) {
                        setDetailError((e as Error).message);
                      } finally {
                        setDiffLoading(false);
                      }
                    }}
                  />
                ))}
              </div>
              {diffLoading && <div className="spinner">{t("Common_Loading")}</div>}
              {fileDiff && (
                <div style={{ height: "55%", overflow: "auto", borderTop: "1px solid var(--c-border)" }}>
                  <DiffView diff={fileDiff} inline={app.settings?.diffMode === "inline"} />
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">{detailError ?? t("Log_SelectCommitHint")}</div>
          )}
        </div>} />
      {resetTarget && (
        <Modal
          title={t("Log_ResetTitle")}
          confirmText={t("Log_ResetConfirm")}
          danger={resetMode === "hard"}
          onClose={() => setResetTarget(null)}
          onConfirm={() => void doReset()}
        >
          <div style={{ userSelect: "text" }}>
            <div>
              {t("Log_ResetBranchInfo", branches.current ?? "?")} → <span className="mono">{resetTarget.shortSha}</span> {resetTarget.subject}
            </div>
            {(["soft", "mixed", "hard"] as const).map((m) => (
              <label key={m} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8, cursor: "pointer" }}>
                <input
                  type="radio"
                  checked={resetMode === m}
                  onChange={() => setResetMode(m)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  <b style={{ color: m === "hard" ? "var(--c-red)" : undefined }}>{t(`Log_ResetMode_${m}`)}</b>
                  <div style={{ fontSize: 11, color: "var(--c-text2)" }}>{t(`Log_ResetDesc_${m}`)}</div>
                </span>
              </label>
            ))}
            {resetMode === "hard" && (
              <div style={{ color: "var(--c-red)", fontSize: 11.5, marginTop: 8 }}>{t("Log_ResetHardWarning")}</div>
            )}
          </div>
        </Modal>
      )}
      {menuElement}
    </>
  );
}

function FileRow({ file, active, onOpen }: { file: FileMetaDTO; active: boolean; onOpen: () => void }) {
  return (
    <div className={"list-row" + (active ? " selected" : "")} onClick={onOpen}>
      <span className={"status-letter st-" + file.statusCode}>{file.statusCode}</span>
      <span className="trim" style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 12 }}>{file.path}</span>
      {file.added !== null && <span className="diff-stats-add">+{file.added}</span>}
      {file.deleted !== null && <span className="diff-stats-del">−{file.deleted}</span>}
    </div>
  );
}

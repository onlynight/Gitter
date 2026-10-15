/**
 * 实时变更面板（v3.2 · docs/task-page-live-changes.md）：
 * 编辑器式 tab 面板——固定首 tab「按轮」（上=轮次列表，下=该轮变更文件）+ 文件预览 tab
 * （预览=highlight.file 语法高亮只读 / 差异=MonacoDiffView（二进制/超长回退 DiffView），全高显示，可关闭）。
 * 编辑 = 分裂按钮主钮跳文件页内置编辑器（默认动作）；外部应用 = 下拉列表（shell.openPath）。
 * 数据全部复用既有 RPC：checkpoints / files / diff(since=checkpoint:<sha>) / file.content / highlight.file / file.readBinary / shell.openPath。
 * monaco 由 gitui.lib.monaco 库包提供（tasks 页 manifest dependencies，构建不打包）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { call } from "../bridge/client";
import type { AgentCheckpointDTO, AgentTaskFileDTO, DiffDTO, DiffFullDTO, RiskFileReport, RiskReport } from "../bridge/types";
import { DiffView, MonacoDiffView } from "../kit";
import { taskPanels, useAgentUIVersion } from "../external/agentUIShim";
import { TlIcon } from "./taskIcons";
import { ExternalFilePreview, isExternalPreviewPath } from "./externalPreview";
import { absPathOf } from "./filesPaths";

const IMG_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i;
/** 扩展名 → data URL MIME（jpg/svg/ico 规范写法；「image/svg」非法，缺 +xml 渲染不出） */
function imgMime(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "png";
  if (ext === "jpg") return "jpeg";
  if (ext === "svg") return "svg+xml";
  if (ext === "ico") return "x-icon";
  return ext || "png";
}
const MAX_TEXT_BYTES = 2_000_000;
const TURNS_TAB = "turns";

/** M2.2 风险等级 → 颜色（复用语义色令牌） */
export function riskColor(level: "high" | "medium" | "low"): string {
  return level === "high" ? "var(--c-red)" : level === "medium" ? "var(--c-amber)" : "var(--c-fg3)";
}
/** M2.4 审查三态徽标文案 */
function reviewLabel(status: string): { text: string; color: string } {
  return status === "approved" ? { text: "已通过", color: "var(--c-green)" }
    : status === "rejected" ? { text: "已退回", color: "var(--c-red)" }
    : { text: "待审查", color: "var(--c-amber)" };
}

type SyntaxRun = { start: number; end: number; style: string; color?: string };
type FileTab = { path: string; origin: string }; // origin = 来源轮次（"latest" = 工作区当前内容）
type ViewState =
  | { kind: "empty" }
  | { kind: "loading" }
  | { kind: "text"; lines: SyntaxRun[][]; plain: string[]; syntaxColors: Record<string, string> }
  | { kind: "image"; url: string }
  | { kind: "external" }
  | { kind: "binary" }
  | { kind: "toolarge" }
  | { kind: "error"; message: string };

function letterColor(letter: "A" | "D" | "M"): string {
  return letter === "A" ? "var(--c-green)" : letter === "D" ? "var(--c-red)" : "var(--c-amber)";
}
function baseName(p: string): string {
  return p.split("/").pop() ?? p;
}
function tabId(path: string): string {
  return `file:${path}`;
}

export function TaskChangesPanel(props: {
  taskId: string;
  worktreePath: string;
  tick: number;
  request: { path: string; mode: "preview" | "diff"; ts: number } | null;
  onEditInFilesPage: (path: string) => void;
  onCollapse: () => void;
}) {
  const [tabs, setTabs] = useState<(string | FileTab)[]>([TURNS_TAB]); // "turns" 固定首位，其余为文件 tab
  const [active, setActive] = useState<string>(TURNS_TAB);
  const [turn, setTurn] = useState<string>("latest"); // 按轮页当前选中轮次
  const [modes, setModes] = useState<Record<string, "preview" | "diff">>({});
  const [full, setFull] = useState<DiffFullDTO | null>(null); // 选中文件的全量双文本（monaco diff）
  const [cps, setCps] = useState<AgentCheckpointDTO[]>([]);
  const [letters, setLetters] = useState<Record<string, "A" | "D" | "M">>({});
  const [files, setFiles] = useState<{ path: string; letter: "A" | "D" | "M"; added: number | null; deleted: number | null }[]>([]);
  const [diffs, setDiffs] = useState<DiffDTO[]>([]); // 文件 tab：差异
  const [view, setView] = useState<ViewState>({ kind: "empty" }); // 文件 tab：预览
  const [err, setErr] = useState<string | null>(null);
  const lastReq = useRef(0);
  // M2.1 验收台双基线：task = 自任务开始（squash 视角，含 checkpoint）；head = 工作区 vs 当前分支头
  const [base, setBase] = useState<"task" | "head">("task");
  // M2.2 风险信号（纯规则）
  const [risk, setRisk] = useState<RiskReport | null>(null);
  // M2.4 审查三态
  const [review, setReview] = useState<{ status: string; comment: string | null } | null>(null);
  const [reviewEditing, setReviewEditing] = useState<false | "approve" | "reject">(false);
  const [reviewComment, setReviewComment] = useState("");
  // 插件面板贡献（v3.2 插件化）：注册表按层级拉取，热插拔经 useAgentUIVersion 响应
  const uiV = useAgentUIVersion();
  const pluginPanels = useMemo(() => taskPanels(), [uiV]);
  const activePlugin = pluginPanels.find((p) => p.def.id === active) ?? null;
  function letterOf(path: string): "A" | "D" | "M" {
    return letters[path] ?? "M";
  }

  const activePath = active === TURNS_TAB ? undefined : active;
  const activeMode = activePath ? modes[activePath] ?? "preview" : "preview";
  const activeOrigin = (() => {
    const t = tabs.find((t): t is FileTab => typeof t !== "string" && tabId((t as FileTab).path) === active);
    return t ? (t as FileTab).origin : "latest";
  })();
  const isImg = !!activePath && IMG_RE.test(activePath);

  // 轮次列表（最新在前）
  useEffect(() => {
    let cancelled = false;
    void call<AgentCheckpointDTO[]>("agent.task.checkpoints", { taskId: props.taskId })
      .then((x) => { if (!cancelled) setCps(x.slice().reverse()); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [props.taskId, props.tick]);

  // 按轮页：选中轮次的文件列表（最新一轮 = 基线切换；历史轮 = 该轮 diff）
  useEffect(() => {
    if (active !== TURNS_TAB) return;
    let cancelled = false;
    if (turn === "latest") {
      if (base === "head") {
        // HEAD 基线：工作区+暂存 vs 当前分支头（不含未跟踪）
        void call<DiffDTO[]>("agent.task.diff", { taskId: props.taskId, base: "head" })
          .then((ds) => {
            if (cancelled) return;
            setFiles(ds.map((d) => ({ path: d.path, letter: d.isNew ? "A" : d.isDeleted ? "D" : "M", added: d.addedLines, deleted: d.deletedLines })));
            setLetters((lm) => {
              const nm = { ...lm };
              ds.forEach((d) => { nm[d.path] = d.isNew ? "A" : d.isDeleted ? "D" : "M"; });
              return nm;
            });
          })
          .catch(() => { if (!cancelled) setFiles([]); });
      } else {
        void call<AgentTaskFileDTO[]>("agent.task.files", { taskId: props.taskId })
          .then((fs) => {
            if (cancelled) return;
            setFiles(fs.map((f) => ({ path: f.path, letter: f.kind === "added" ? "A" : f.kind === "deleted" ? "D" : "M", added: f.added, deleted: f.deleted })));
            setLetters((lm) => {
              const nm = { ...lm };
              fs.forEach((f) => { nm[f.path] = f.kind === "added" ? "A" : f.kind === "deleted" ? "D" : "M"; });
              return nm;
            });
          })
          .catch(() => { if (!cancelled) setFiles([]); });
      }
    } else {
      void call<DiffDTO[]>("agent.task.diff", { taskId: props.taskId, since: `checkpoint:${turn}` })
        .then((ds) => {
          if (cancelled) return;
          setFiles(ds.map((d) => ({ path: d.path, letter: d.isNew ? "A" : d.isDeleted ? "D" : "M", added: d.addedLines, deleted: d.deletedLines })));
          setLetters((lm) => {
            const nm = { ...lm };
            ds.forEach((d) => { nm[d.path] = d.isNew ? "A" : d.isDeleted ? "D" : "M"; });
            return nm;
          });
        })
        .catch(() => { if (!cancelled) setFiles([]); });
    }
    return () => { cancelled = true; };
  }, [active, turn, base, props.taskId, props.tick]);

  // M2.2 风险信号 + M2.4 审查态（tick 驱动刷新）
  useEffect(() => {
    let cancelled = false;
    void call<RiskReport>("agent.task.risk", { taskId: props.taskId }).then((r) => { if (!cancelled) setRisk(r); }).catch(() => {});
    void call<{ tasks: { taskId: string; review?: { status: string; comment: string | null } | null }[] }>("agent.tasks", {})
      .then((x) => { if (!cancelled) setReview(x.tasks.find((t) => t.taskId === props.taskId)?.review ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [props.taskId, props.tick]);

  const submitReview = useCallback((decision: "approve" | "reject", comment: string) => {
    void call("agent.task.review.set", { taskId: props.taskId, status: decision === "approve" ? "approved" : "rejected", comment: comment || null })
      .then(() => {
        setReview(decision === "approve" ? { status: "approved", comment: null } : { status: "rejected", comment });
        setReviewEditing(false);
        setReviewComment("");
      })
      .catch((e) => setErr((e as Error).message));
  }, [props.taskId]);

  // 对话流 查看/预览 → 打开/激活文件 tab（右侧 = 主预览面）
  useEffect(() => {
    const req = props.request;
    if (!req || req.ts === lastReq.current) return;
    lastReq.current = req.ts;
    openFileTab(req.path, "latest", req.mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.request?.ts]);

  // 文件 tab 差异（懒加载；scope = 来源轮次；latest 走验收台基线切换）
  useEffect(() => {
    if (activePath === undefined || activeMode !== "diff") { setDiffs([]); return; }
    let cancelled = false;
    const origin = tabs.find((t): t is FileTab => typeof t !== "string" && (t as FileTab).path === activePath)?.origin ?? "latest";
    const since = origin === "latest" ? undefined : `checkpoint:${origin}`;
    const rpcBase = origin === "latest" && turn === "latest" && base === "head" ? "head" as const : "baseline" as const;
    void call<DiffFullDTO>("agent.task.diffFull", { taskId: props.taskId, path: activePath, since, base: rpcBase })
      .then(async (f) => {
        if (cancelled) return;
        setFull(f);
        if (f.isBinary || f.tooLarge) {
          // 回退位：hunk 版 DiffView
          const d = await call<DiffDTO[]>("agent.task.diff", { taskId: props.taskId, path: activePath, since, base: rpcBase }).catch(() => []);
          if (!cancelled) setDiffs(d);
        } else if (!cancelled) {
          setDiffs([]);
        }
      })
      .catch(() => { if (!cancelled) { setFull(null); setDiffs([]); } });
    return () => { cancelled = true; };
  }, [activePath, activeMode, props.taskId, base, turn]);

  // 文件 tab 预览（文本高亮 / 图片；预览始终读当前工作区文件）
  useEffect(() => {
    if (activePath === undefined || activeMode !== "preview") return;
    let cancelled = false;
    setErr(null);
    if (IMG_RE.test(activePath)) {
      setView({ kind: "loading" });
      void call<{ base64?: string }>("file.readBinary", { path: activePath })
        .then((r) => {
          if (cancelled) return;
          setView({ kind: "image", url: `data:image/${imgMime(activePath)};base64,${r?.base64 ?? ""}` });
        })
        .catch((e) => { if (!cancelled) setView({ kind: "error", message: (e as Error).message }); });
      return () => { cancelled = true; };
    }
    // Markdown/HTML 族：外部预览插件接管（file.preview previewProviders 接缝，组件自管
    // 加载/回退——无插件时回退卡内可直接跳内置编辑器），文本高亮通道不参与
    if (isExternalPreviewPath(activePath)) {
      setView({ kind: "external" });
      return () => { cancelled = true; };
    }
    setView({ kind: "loading" });
    (async () => {
      try {
        const r = await call<{ content: string; binary?: boolean; truncated?: boolean } | null>("file.content", { path: activePath, revision: "worktree", maxBytes: MAX_TEXT_BYTES });
        if (cancelled) return;
        if (!r || r.binary) { setView({ kind: "binary" }); return; }
        if (r.truncated) { setView({ kind: "toolarge" }); return; }
        const hl = await call<{ lines: SyntaxRun[][]; syntaxColors: Record<string, string> }>("highlight.file", { path: activePath, text: r.content }).catch(() => null);
        if (cancelled) return;
        setView({ kind: "text", lines: hl?.lines ?? [], plain: r.content.split("\n"), syntaxColors: hl?.syntaxColors ?? {} });
      } catch (e) {
        if (!cancelled) setView({ kind: "error", message: (e as Error).message });
      }
    })();
    return () => { cancelled = true; };
  }, [activePath, activeMode, props.taskId]);

  const activate = (id: string) => setActive(id);
  function openFileTab(path: string, origin: string, mode?: "preview" | "diff") {
    setTabs((cur) => {
      const ids = cur.map((t) => (typeof t === "string" ? t : (t as FileTab).path));
      if (ids.includes(path)) return cur;
      return [...cur, { path, origin }];
    });
    setActive(path);
    if (mode) setModes((m) => ({ ...m, [path]: mode }));
  }
  const closeTab = useCallback((id: string) => {
    setTabs((cur) => cur.filter((t) => (typeof t === "string" ? t : (t as FileTab).path) !== id));
    setActive((cur) => (cur === id ? TURNS_TAB : cur));
  }, []);

  const openExternal = useCallback((useExternalEditor: boolean) => {
    if (!activePath) return;
    const full = absPathOf(props.worktreePath, activePath);
    void call("shell.openPath", { path: full, editor: useExternalEditor || undefined }).catch((e) => setErr((e as Error).message));
  }, [activePath, props.worktreePath]);

  const fileTabNodes = tabs.filter((t): t is FileTab => typeof t !== "string");
  const hintText = turn !== "latest"
    ? `该轮快照（${turn.slice(0, 8)}^..${turn.slice(0, 8)}）· 只读回看`
    : base === "head"
      ? "基线 = 当前分支头（工作区+暂存 vs HEAD）· 不含未跟踪文件"
      : "基线 = 任务起点（squash 视角，含全部 checkpoint）";
  // M2.2 逐文件风险（最高级）
  const riskByPath = useMemo(() => {
    const m = new Map<string, RiskFileReport>();
    for (const f of risk?.files ?? []) m.set(f.path, f);
    return m;
  }, [risk]);
  const riskCounts = risk?.counts ?? null;

  return (
    <div className="lc-panel">
      {/* M2.4 审查三态栏（验收台人机共享） */}
      <div className="lc-review">
        {review ? (
          <span className="lc-review-chip" style={{ color: reviewLabel(review.status).color }} title={review.comment ?? ""}>
            ● 审查：{reviewLabel(review.status).text}{review.comment ? ` · ${review.comment.slice(0, 60)}` : ""}
          </span>
        ) : (
          <span className="lc-review-chip" style={{ color: "var(--c-fg3)" }}>● 审查：未评审</span>
        )}
        <span style={{ flex: 1 }} />
        {reviewEditing === false ? (
          <>
            <button className="tool-btn icon" title="通过本轮改动（结论注入 agent 下一轮）" aria-label="通过"
              onClick={() => submitReview("approve", "")}>
              <TlIcon name="check" size={13} color="var(--c-green)" />
            </button>
            <button className="tool-btn icon" title="退回并附审查意见（自动直投修复轮）" aria-label="退回"
              onClick={() => { setReviewEditing("reject"); setReviewComment(""); }}>
              <TlIcon name="x" size={13} color="var(--c-red)" />
            </button>
          </>
        ) : (
          <>
            <input
              className="lc-review-input"
              placeholder={reviewEditing === "reject" ? "审查意见（退回原因，进入 agent 下一轮）" : "补充说明（可空）"}
              value={reviewComment}
              autoFocus
              onChange={(e) => setReviewComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (reviewEditing === "approve" || reviewComment.trim())) submitReview(reviewEditing, reviewComment);
                if (e.key === "Escape") setReviewEditing(false);
              }}
            />
            <button className="tool-btn" disabled={reviewEditing === "reject" && !reviewComment.trim()} onClick={() => submitReview(reviewEditing, reviewComment)}>确认</button>
            <button className="tool-btn" onClick={() => setReviewEditing(false)}>取消</button>
          </>
        )}
      </div>
      <div className="lc-tabs">
        <button className={"lc-tab turns" + (active === TURNS_TAB ? " on" : "")} title="按轮查看变更（固定，不可关闭）" onClick={() => activate(TURNS_TAB)}>
          <TlIcon name="commit" size={12} />
          按轮
        </button>
        {pluginPanels.map(({ def }) => (
          <button key={def.id} className={"lc-tab" + (active === def.id ? " on" : "")} title={def.title} onClick={() => setActive(def.id)}>
            {def.title}
          </button>
        ))}
        {fileTabNodes.map((t) => (
          <button key={t.path} className={"lc-tab file" + (active === t.path ? " on" : "")} title={t.path} onClick={() => setActive(t.path)}>
            <span className="lc-file-letter" style={{ color: letterColor(letterOf(t.path)) }}>{letterOf(t.path)}</span>
            {baseName(t.path)}
            <span className="lc-x" title="关闭" onClick={(e) => { e.stopPropagation(); closeTab(t.path); }}>✕</span>
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button className="tool-btn icon" title="收起面板，回到纯对话" aria-label="收起面板" onClick={props.onCollapse}>
          <TlIcon name="splitpane" size={13} />
        </button>
      </div>

      {activePlugin ? (
        <div className="lc-body" style={{ display: "flex" }}>
          {activePlugin.def.render({ taskId: props.taskId })}
        </div>
      ) : active === TURNS_TAB ? (
        <div className="lc-turnspage">
          <div className="lc-turns">
            <div className="lc-hint">按轮查看变更 · 点击轮次载入该轮文件列表</div>
            <button className={"lc-turn" + (turn === "latest" ? " sel" : "")} onClick={() => setTurn("latest")}>
              <span className="lc-turn-dot" style={{ background: "var(--c-green)" }} />
              <span className="lc-turn-sum">最新改动</span>
              {/* M2.1 验收台双基线切换 */}
              <span className="lc-seg lc-base-seg" onClick={(e) => e.stopPropagation()}>
                <button className={base === "task" ? "on" : ""} title="自任务开始以来（工作区 + checkpoint 提交的净 diff，squash 视角）" onClick={() => setBase("task")}>任务起点</button>
                <button className={base === "head" ? "on" : ""} title="工作区 + 暂存 vs 当前分支头（不含未跟踪）" onClick={() => setBase("head")}>vs HEAD</button>
              </span>
            </button>
            {cps.map((c) => (
              <button key={c.sha} className={"lc-turn" + (turn === c.sha ? " sel" : "")} title={`${c.summary}\n${c.date.slice(5, 16).replace("T", " ")}`} onClick={() => setTurn(c.sha)}>
                <span className="lc-turn-dot" />
                <span className="lc-turn-sum">cp {c.sha.slice(0, 8)} · {c.summary.replace(/^checkpoint:\s*/, "")}</span>
                <span className="lc-turn-time">{c.date.slice(5, 16).replace("T", " ")}</span>
              </button>
            ))}
          </div>
          <div className="lc-fileswrap">
            <div className="lc-hint">
              {hintText}
              {/* M2.2 风险汇总条 */}
              {riskCounts && (riskCounts.high + riskCounts.medium + riskCounts.low) > 0 ? (
                <span className="lc-risk-sum" title="纯规则风险信号（零 AI 依赖）">
                  {" · 风险："}
                  {riskCounts.high > 0 && <span style={{ color: "var(--c-red)" }}>{riskCounts.high} 高 </span>}
                  {riskCounts.medium > 0 && <span style={{ color: "var(--c-amber)" }}>{riskCounts.medium} 中 </span>}
                  {riskCounts.low > 0 && <span style={{ color: "var(--c-fg3)" }}>{riskCounts.low} 低</span>}
                </span>
              ) : null}
            </div>
            {files.map((f) => {
              const rf = riskByPath.get(f.path);
              const top = rf?.signals[0];
              return (
                <button key={f.path} className="lc-file" title={`${f.path} · 预览 / 差异${top ? `\n⚠ ${rf!.signals.map((s) => s.message).join("\n⚠ ")}` : ""}`} onClick={() => openFileTab(f.path, turn)}>
                  <span className="lc-file-letter" style={{ color: letterColor(f.letter) }}>{f.letter}</span>
                  <span className="lc-file-path">{f.path}</span>
                  {top ? <span className="lc-risk-dot" style={{ background: riskColor(top.level) }} title={rf!.signals.map((s) => `[${s.level}] ${s.message}`).join("\n")} /> : null}
                  <span className="lc-file-stats">{f.added != null ? `+${f.added} −${f.deleted ?? 0}` : ""}</span>
                </button>
              );
            })}
            {files.length === 0 && <div className="lc-hint">{turn !== "latest" ? "该轮无改动" : base === "head" ? "工作区相对 HEAD 无差异（未跟踪文件请切「任务起点」基线查看）" : "暂无改动"}</div>}
          </div>
        </div>
      ) : (
        <div className="lc-filepage">
          <div className="lc-viewbar">
            <span className="lc-file-letter" style={{ color: letterColor(letterOf(activePath ?? "")) }}>{letterOf(activePath ?? "")}</span>
            <span className="lc-viewbar-path">{activePath ?? "—"}</span>
            <div className="lc-seg">
              <button className={activeMode === "preview" ? "on" : ""} onClick={() => activePath && setModes((m) => ({ ...m, [activePath]: "preview" }))}>预览</button>
              <button className={activeMode === "diff" ? "on" : ""} onClick={() => activePath && setModes((m) => ({ ...m, [activePath]: "diff" }))}>差异</button>
            </div>
            <span style={{ flex: 1 }} />
            <div className="splitbtn">
              <button className="lc-split-main" disabled={!activePath} title="跳到内置编辑器（文件页）编辑" onClick={() => activePath && props.onEditInFilesPage(activePath)}>
                <TlIcon name="pencil" size={12} />
                内置编辑器
              </button>
              <button className="lc-split-chev" disabled={!activePath} title="用其他应用打开" onClick={(e) => { e.stopPropagation(); document.getElementById("lcAppMenu")?.classList.toggle("on"); }}>
                ▾
              </button>
              <div className="lc-split-menu" id="lcAppMenu">
                <div className="lc-split-head">用外部应用打开当前文件</div>
                <button className="lc-split-item" onClick={() => { openExternal(true); document.getElementById("lcAppMenu")?.classList.remove("on"); }}>
                  VS Code（settings.externalEditor）
                </button>
                <button className="lc-split-item" onClick={() => { openExternal(false); document.getElementById("lcAppMenu")?.classList.remove("on"); }}>
                  系统默认应用
                </button>
              </div>
            </div>
          </div>
          {err && <div className="lc-err">{err}</div>}
          <div className="lc-body">
            {activeMode === "diff" ? (
              full && !full.isBinary && !full.tooLarge
                ? <MonacoDiffView full={full} />
                : diffs.length === 0
                  ? <div className="lc-loading">（无差异）</div>
                  : diffs.filter((d) => d.path === activePath || d.oldPath === activePath).map((d) => <DiffView key={d.path} diff={d} />)
            ) : view.kind === "loading" ? (
              <div className="lc-loading">加载中…</div>
            ) : view.kind === "image" ? (
              <img className="lc-img" src={view.url} alt={activePath ?? ""} />
            ) : view.kind === "external" ? (
              <ExternalFilePreview
                path={activePath ?? ""}
                fallbackBody="未安装提供该格式预览的插件（Markdown/HTML 预览），或未在 设置 → 扩展 打开「允许代码插件」"
                onEditText={() => activePath && props.onEditInFilesPage(activePath)}
              />
            ) : view.kind === "text" ? (
              <pre className="lc-code">
                {view.lines.length > 0
                  ? view.lines.map((runs, li) => (
                      <div className="lc-line" key={li}>
                        <span className="lc-ln">{li + 1}</span>
                        <span className="lc-code">
                          {runs.length === 0
                            ? (view.plain[li] ?? "")
                            : runs.map((r, ri) => (
                                <span key={ri} style={{ color: r.color ?? view.syntaxColors[r.style] }}>{view.plain[li]?.slice(r.start, r.end)}</span>
                              ))}
                        </span>
                      </div>
                    ))
                  : view.plain.map((t, li) => (
                      <div className="lc-line" key={li}>
                        <span className="lc-ln">{li + 1}</span>
                        <span className="lc-code">{t}</span>
                      </div>
                    ))}
              </pre>
            ) : view.kind === "binary" ? (
              <div className="lc-loading">二进制文件——请用「外部应用」打开</div>
            ) : view.kind === "toolarge" ? (
              <div className="lc-loading">文件过大——请用「外部应用」打开</div>
            ) : view.kind === "error" ? (
              <div className="lc-loading">读取失败：{view.message}</div>
            ) : (
              <div className="lc-loading">（选择文件）</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

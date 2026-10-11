/**
 * 实时变更面板（v3.2 · docs/task-page-live-changes.md）：
 * 编辑器式 tab 面板——固定首 tab「按轮」（上=轮次列表，下=该轮变更文件）+ 文件预览 tab
 * （预览=highlight.file 语法高亮只读 / 差异=DiffView，全高显示，可关闭）。
 * 编辑 = 分裂按钮主钮跳文件页内置编辑器（默认动作）；外部应用 = 下拉列表（shell.openPath）。
 * 数据全部复用既有 RPC：checkpoints / files / diff(since=checkpoint:<sha>) / file.content / highlight.file / file.readBinary / shell.openPath。
 * 边界（构建策略「monaco 仅 files 页」）：面板不打包 Monaco。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { call } from "../bridge/client";
import type { AgentCheckpointDTO, AgentTaskFileDTO, DiffDTO } from "../bridge/types";
import { DiffView } from "../kit";
import { taskPanels, useAgentUIVersion } from "../external/agentUIShim";
import { TlIcon } from "./taskIcons";
import { ExternalFilePreview, isMdPath } from "./externalPreview";
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
  const [cps, setCps] = useState<AgentCheckpointDTO[]>([]);
  const [letters, setLetters] = useState<Record<string, "A" | "D" | "M">>({});
  const [files, setFiles] = useState<{ path: string; letter: "A" | "D" | "M"; added: number | null; deleted: number | null }[]>([]);
  const [diffs, setDiffs] = useState<DiffDTO[]>([]); // 文件 tab：差异
  const [view, setView] = useState<ViewState>({ kind: "empty" }); // 文件 tab：预览
  const [err, setErr] = useState<string | null>(null);
  const lastReq = useRef(0);
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

  // 按轮页：选中轮次的文件列表（最新一轮 = 工作区；历史轮 = 该轮 diff）
  useEffect(() => {
    if (active !== TURNS_TAB) return;
    let cancelled = false;
    if (turn === "latest") {
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
  }, [active, turn, props.taskId, props.tick]);

  // 对话流 查看/预览 → 打开/激活文件 tab（右侧 = 主预览面）
  useEffect(() => {
    const req = props.request;
    if (!req || req.ts === lastReq.current) return;
    lastReq.current = req.ts;
    openFileTab(req.path, "latest", req.mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.request?.ts]);

  // 文件 tab 差异（懒加载；scope = 来源轮次）
  useEffect(() => {
    if (activePath === undefined || activeMode !== "diff") { setDiffs([]); return; }
    let cancelled = false;
    const origin = tabs.find((t): t is FileTab => typeof t !== "string" && (t as FileTab).path === activePath)?.origin ?? "latest";
    const since = origin === "latest" ? undefined : `checkpoint:${origin}`;
    void call<DiffDTO[]>("agent.task.diff", { taskId: props.taskId, path: activePath, since })
      .then((d) => { if (!cancelled) setDiffs(d); })
      .catch(() => { if (!cancelled) setDiffs([]); });
    return () => { cancelled = true; };
  }, [activePath, activeMode, props.taskId]);

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
    // Markdown 族：外部预览插件接管（file.preview previewProviders 接缝，组件自管
    // 加载/回退——无插件时回退卡内可直接跳内置编辑器），文本高亮通道不参与
    if (isMdPath(activePath)) {
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
  const hintText = turn === "latest"
    ? "最新一轮（工作区当前内容）· 点击文件 → 新开 tab 预览 / 差异"
    : `该轮快照（${turn.slice(0, 8)}^..${turn.slice(0, 8)}）· 只读回看`;

  return (
    <div className="lc-panel">
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
        <button className="tool-btn" title="收起面板，回到纯对话" onClick={props.onCollapse}>收起</button>
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
              <span className="lc-turn-sum">最新一轮 · 工作区当前内容</span>
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
            <div className="lc-hint">{hintText}</div>
            {files.map((f) => (
              <button key={f.path} className="lc-file" title={`${f.path} · 预览 / 差异`} onClick={() => openFileTab(f.path, turn)}>
                <span className="lc-file-letter" style={{ color: letterColor(f.letter) }}>{f.letter}</span>
                <span className="lc-file-path">{f.path}</span>
                <span className="lc-file-stats">{f.added != null ? `+${f.added} −${f.deleted ?? 0}` : ""}</span>
              </button>
            ))}
            {files.length === 0 && <div className="lc-hint">{turn === "latest" ? "暂无改动" : "该轮无改动"}</div>}
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
              diffs.length === 0
                ? <div className="lc-loading">（无差异）</div>
                : diffs.filter((d) => d.path === activePath || d.oldPath === activePath).map((d) => <DiffView key={d.path} diff={d} />)
            ) : view.kind === "loading" ? (
              <div className="lc-loading">加载中…</div>
            ) : view.kind === "image" ? (
              <img className="lc-img" src={view.url} alt={activePath ?? ""} />
            ) : view.kind === "external" ? (
              <ExternalFilePreview
                path={activePath ?? ""}
                fallbackBody="未安装 Markdown 预览插件，或未在 设置 → 扩展 打开「允许代码插件」"
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

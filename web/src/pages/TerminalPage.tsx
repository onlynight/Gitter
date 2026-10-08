import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { pageSdk, useAppState } from "../pageSdk";
import type { TerminalSessionDTO, ThemeStateDTO } from "../bridge/types";
import { GitDocPanel } from "../components/GitDocPanel";

// R1 宿主面收敛：本页只经 pageSdk 消费宿主（ui-full-pluginization-plan.md R1）
const { call, on: onEvent, t, repo: repoOf, settings: settingsOf, theme: themeOf, updateSettings } = pageSdk;
const useApp = useAppState;

/** 终端页多标签（Windows Terminal 交互形式，docs/terminal-tabs.md）：
 *  每标签一个独立 pty 会话 + 独立 xterm 实例；切换不销毁（后台输出持续写入）；
 *  标签恢复经 terminal.list；＋/⌄ 新建；× 关闭（运行中确认）；Ctrl+Tab 循环切换。
 *  右侧 Git 命令文档面板（design/terminal-git-docs-mockup.html）：文档钮开合，
 *  分隔条拖拽调宽（默认 2/5，松手持久化 settings.terminalDocFraction，双击复位）。 */

/** 文档面板分栏比例钳制：保证终端/面板两侧最小可用宽度 */
const DOC_FRAC_DEFAULT = 0.4;
const DOC_FRAC_MIN = 0.26;
const DOC_FRAC_MAX = 0.65;
const clampDocFrac = (v: number) => Math.min(DOC_FRAC_MAX, Math.max(DOC_FRAC_MIN, v));

/** 页间切换不丢开合状态（不入设置——只有宽度比例入设置） */
let docOpenMemo = false;

interface TermTab {
  sessionId: string;
  shellKind: string;
}

const PROFILES = [
  { value: "powershell", label: "PowerShell" },
  { value: "cmd", label: "CMD" },
  { value: "bash", label: "Git Bash" },
];

const labelOf = (kind: string) => PROFILES.find((p) => p.value === kind)?.label ?? kind;

export function TerminalPage() {
  const app = useApp();
  const wrapRef = useRef<HTMLDivElement>(null);
  const termsRef = useRef(new Map<string, { term: Terminal; fit: FitAddon }>());
  const hostsRef = useRef(new Map<string, HTMLDivElement | null>());
  const [tabs, setTabs] = useState<TermTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [exits, setExits] = useState<Record<string, number>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const restoredRef = useRef(false);
  const areaRef = useRef<HTMLDivElement>(null);
  const [docOpen, setDocOpenState] = useState(docOpenMemo);
  const setDocOpen = (open: boolean) => {
    docOpenMemo = open;
    setDocOpenState(open);
  };
  const [docFrac, setDocFrac] = useState(() => {
    const saved = settingsOf()?.terminalDocFraction;
    return typeof saved === "number" ? clampDocFrac(saved) : DOC_FRAC_DEFAULT;
  });
  // 最新比例镜像（ref）：拖拽保存读它，免受事件批处理时序影响
  const docFracRef = useRef(docFrac);
  const applyDocFrac = (f: number) => {
    docFracRef.current = f;
    setDocFrac(f);
  };
  const [docFracDragging, setDocFracDragging] = useState(false);
  const docFracDragRef = useRef<{ startX: number; startFrac: number } | null>(null);

  /** 终端画布对齐表面档：材质开启时把 alpha 段重写为低不透明（叠层补偿）。 */
  const withAlpha = (hex: string | undefined, suffix: string, fallback: string): string => {
    const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(hex ?? fallback);
    return m ? `#${m[1]}${suffix}` : (hex ?? fallback);
  };

  const buildTheme = (theme: ThemeStateDTO | null) => {
    const blur = (theme?.material ?? "none") !== "none";
    return {
      background: withAlpha(theme?.tokens["Base"], blur ? "14" : "", "#1E1F22"),
      foreground: theme?.tokens["Text"] ?? "#DFE1E5",
      cursor: theme?.tokens["Accent"] ?? "#3574F0",
      selectionBackground: theme?.tokens["Selected"] ?? "#43454A",
      black: theme?.terminal["black"] ?? "#000000",
      red: theme?.terminal["red"] ?? "#F75464",
      green: theme?.terminal["green"] ?? "#6FBF73",
      yellow: theme?.terminal["yellow"] ?? "#C8A35F",
      blue: theme?.terminal["blue"] ?? "#3574F0",
      magenta: theme?.terminal["magenta"] ?? "#C9A2FF",
      cyan: theme?.terminal["cyan"] ?? "#8FB8E8",
      white: theme?.terminal["white"] ?? "#DFE1E5",
    };
  };

  const applyTheme = useCallback(() => {
    const theme = buildTheme(themeOf());
    for (const { term } of termsRef.current.values()) term.options.theme = theme;
  }, [themeOf]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 在宿主容器创建 xterm 实例（懒创建：标签首次激活时）。 */
  const createTerm = useCallback((tab: TermTab) => {
    const host = hostsRef.current.get(tab.sessionId);
    if (!host || termsRef.current.has(tab.sessionId)) return;
    const term = new Terminal({
      fontFamily: `${settingsOf()?.terminalFontFamily ?? "Cascadia Mono"}, Consolas, monospace`,
      fontSize: settingsOf()?.terminalFontSize ?? 13,
      cursorBlink: true,
      allowProposedApi: true,
      allowTransparency: true, // 模糊窗口下背景带 alpha（随 buildTheme 切换）
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    term.options.theme = buildTheme(themeOf());
    termsRef.current.set(tab.sessionId, { term, fit });
    applyTheme();
    try { fit.fit(); } catch { /* 隐藏时忽略 */ }

    term.onData((data) => {
      void call("terminal.write", { id: tab.sessionId, dataB64: btoa(unescape(encodeURIComponent(data))) });
    });
  }, [applyTheme, themeOf]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 会话尺寸同步（激活后调用）。 */
  const syncSession = useCallback((tab: TermTab) => {
    const t = termsRef.current.get(tab.sessionId);
    if (!t) return;
    try {
      const dims = t.fit.proposeDimensions();
      if (dims) void call("terminal.resize", { id: tab.sessionId, cols: dims.cols, rows: dims.rows });
    } catch { /* 忽略 */ }
  }, []);

  /** 新建标签：sessionId 由渲染层生成（主进程按 id 建会话）。 */
  const openTab = useCallback(async (shellKind: string) => {
    const sessionId = `tab-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
    const follow = settingsOf()?.terminalFollowRepo ?? true;
    const s = await call<TerminalSessionDTO>("terminal.ensure", {
      cols: 80, rows: 24,
      cwd: follow ? repoOf()?.workDir ?? null : null,
      shellKind,
      sessionId,
    });
    setTabs((prev) => [...prev, { sessionId: s.id, shellKind: s.shellKind }]);
    setActiveId(s.id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** 挂载恢复：terminal.list 的 running 会话重建标签；无则开默认标签。 */
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    void call<TerminalSessionDTO[]>("terminal.list").then((list) => {
      const running = list.filter((s) => s.running);
      setTabs(running.map((s) => ({ sessionId: s.id, shellKind: s.shellKind })));
      setActiveId(running[0]?.id ?? null);
      if (running.length === 0) void openTab(settingsOf()?.terminalShell ?? "powershell");
    }).catch(() => {
      void openTab(settingsOf()?.terminalShell ?? "powershell");
    });
  }, [openTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // 激活切换：懒创建 xterm + fit + resize + focus
  useEffect(() => {
    if (!activeId) return;
    const tab = tabs.find((x) => x.sessionId === activeId);
    if (!tab) return;
    createTerm(tab);
    const t = termsRef.current.get(activeId);
    if (!t) return;
    requestAnimationFrame(() => {
      try { t.fit.fit(); } catch { /* 忽略 */ }
      syncSession(tab);
      t.term.focus();
    });
  }, [activeId, tabs, createTerm, syncSession]);

  // 输出路由：按会话 id 写入对应 xterm（隐藏标签也写入，后台输出不丢）
  useEffect(() => {
    const off = onEvent("terminal.data", (p: { id: string; b64: string }) => {
      const t = termsRef.current.get(p.id);
      if (!t) return;
      const bytes = Uint8Array.from(atob(p.b64), (c) => c.charCodeAt(0));
      t.term.write(bytes);
    });
    return off;
  }, []);

  // 会话退出：记录退出码 + 对应 xterm 打提示
  useEffect(() => {
    const off = onEvent("terminal.exit", (p: { id: string; exitCode: number }) => {
      setExits((prev) => ({ ...prev, [p.id]: p.exitCode }));
      const t = termsRef.current.get(p.id);
      t?.term.writeln(`\r\n\x1b[2m[process exited with code ${p.exitCode}]\x1b[0m`);
    });
    return off;
  }, []);

  // 主题热切换：应用到全部实例
  useEffect(() => { applyTheme(); }, [app.theme, applyTheme]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeTab = useCallback(async (tab: TermTab) => {
    if (exits[tab.sessionId] === undefined) {
      // 会话仍在运行：确认（对齐设计 §四）
      if (!window.confirm(t("Terminal_CloseRunningConfirm", labelOf(tab.shellKind)))) return;
    }
    await call("terminal.close", { id: tab.sessionId }).catch(() => {});
    termsRef.current.get(tab.sessionId)?.term.dispose();
    termsRef.current.delete(tab.sessionId);
    setExits((prev) => { const n = { ...prev }; delete n[tab.sessionId]; return n; });
    setTabs((prev) => {
      const idx = prev.findIndex((x) => x.sessionId === tab.sessionId);
      const next = prev.filter((x) => x.sessionId !== tab.sessionId);
      if (activeId === tab.sessionId) setActiveId(next[Math.min(idx, next.length - 1)]?.sessionId ?? null);
      return next;
    });
  }, [activeId, exits]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl+Tab / Ctrl+Shift+Tab 循环切换（终端页可见时；隐藏槽位不响应）
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.key !== "Tab") return;
      const visible = wrapRef.current && wrapRef.current.offsetParent !== null;
      if (!visible || tabs.length < 2) return;
      e.preventDefault();
      const idx = tabs.findIndex((x) => x.sessionId === activeId);
      const next = e.shiftKey
        ? tabs[(idx - 1 + tabs.length) % tabs.length]
        : tabs[(idx + 1) % tabs.length];
      setActiveId(next.sessionId);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [tabs, activeId]);

  // 外点关闭配置菜单
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const active = tabs.find((x) => x.sessionId === activeId) ?? null;
  const activeStatus = active
    ? `${labelOf(active.shellKind)}${exits[active.sessionId] !== undefined ? ` · exit ${exits[active.sessionId]}` : ""}`
    : "";

  const restartActive = () => {
    if (!active) return;
    const follow = settingsOf()?.terminalFollowRepo ?? true;
    void call<TerminalSessionDTO>("terminal.ensure", {
      cols: 80, rows: 24,
      cwd: follow ? repoOf()?.workDir ?? null : null,
      shellKind: active.shellKind,
      sessionId: active.sessionId,
    });
  };

  // ---- 文档面板分隔条：拖拽调宽（拖动中禁过渡），松手持久化，双击恢复默认 ----
  const onDocSplitDown = (e: React.PointerEvent) => {
    if (!docOpen) return;
    docFracDragRef.current = { startX: e.clientX, startFrac: docFrac };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDocFracDragging(true);
    document.body.style.userSelect = "none";
    e.preventDefault();
  };
  const onDocSplitMove = (e: React.PointerEvent) => {
    const d = docFracDragRef.current;
    const w = areaRef.current?.clientWidth ?? 0;
    if (!d || !w) return;
    applyDocFrac(clampDocFrac(d.startFrac - (e.clientX - d.startX) / w)); // 分割线跟手：鼠标左移 → 文档面板变宽
  };
  const endDocSplitDrag = (e: React.PointerEvent) => {
    if (!docFracDragRef.current) return;
    docFracDragRef.current = null;
    setDocFracDragging(false);
    document.body.style.userSelect = "";
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* 忽略 */ }
    void updateSettings({ terminalDocFraction: docFracRef.current });
  };

  // 容器尺寸变化（窗口缩放/最大化全屏/分栏拖拽/面板开合）→ 重排 xterm 并同步 pty 尺寸
  useEffect(() => {
    if (!activeId) return;
    const host = hostsRef.current.get(activeId);
    const t = termsRef.current.get(activeId);
    if (!host || !t) return;
    let lastCols = 0;
    let lastRows = 0;
    const ro = new ResizeObserver(() => {
      try {
        t.fit.fit();
        const dims = t.fit.proposeDimensions();
        if (dims && (dims.cols !== lastCols || dims.rows !== lastRows)) {
          lastCols = dims.cols;
          lastRows = dims.rows;
          void call("terminal.resize", { id: activeId, cols: dims.cols, rows: dims.rows });
        }
      } catch { /* 忽略 */ }
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="term-page-area" ref={areaRef}>
      <div className="term-wrap" ref={wrapRef}>
        <div className="term-tabs">
          {tabs.map((tab) => (
            <div
              key={tab.sessionId}
              className={"term-tab" + (tab.sessionId === activeId ? " active" : "")}
              title={labelOf(tab.shellKind)}
              onClick={() => setActiveId(tab.sessionId)}
              onAuxClick={(e) => { if (e.button === 1) void closeTab(tab); }}
            >
              <span className="term-tab-ico">{tab.shellKind === "bash" ? "bash" : tab.shellKind === "cmd" ? ">_" : "PS"}</span>
              <span className="term-tab-label">{labelOf(tab.shellKind)}{exits[tab.sessionId] !== undefined ? "（已退出）" : ""}</span>
              <span
                className="term-tab-x"
                title={t("Common_Close")}
                onClick={(e) => { e.stopPropagation(); void closeTab(tab); }}
              >✕</span>
            </div>
          ))}
          <button className="term-tab-new" title={t("Terminal_NewTab", labelOf(settingsOf()?.terminalShell ?? "powershell"))}
            onClick={() => void openTab(settingsOf()?.terminalShell ?? "powershell")}>＋</button>
          <div className="profile-menu-anchor">
            <button className="term-tab-new term-tab-profile" aria-expanded={menuOpen} title={t("Terminal_NewTabProfile")}
              onClick={() => setMenuOpen(!menuOpen)}>
              <svg width="12" height="8" viewBox="0 0 12 8">
                <path d="M2.2 2.6L6 6.4L9.8 2.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {menuOpen && (
              <div className="profile-menu">
                {PROFILES.map((p) => (
                  <div key={p.value} className="profile-menu-item" onClick={() => { setMenuOpen(false); void openTab(p.value); }}>
                    <span>{p.label}</span>
                    <span className="profile-menu-k">{p.value === (settingsOf()?.terminalShell ?? "powershell") ? t("Terminal_ProfileDefault") : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <span style={{ flex: 1 }} />
          <button className="tool-btn icon" title={t("Terminal_Restart")} onClick={restartActive}>
            <span className="glyph">{""}</span>
          </button>
          <button
            className={"tool-btn icon" + (docOpen ? " on" : "")}
            title={t("Terminal_DocTitle")}
            onClick={() => setDocOpen(!docOpen)}
          >
            <span className="glyph">{"\uE8A5"}</span>
          </button>
        </div>
        {tabs.map((tab) => (
          <div
            key={tab.sessionId}
            className="term-host"
            ref={(el) => { hostsRef.current.set(tab.sessionId, el); }}
            style={{ display: tab.sessionId === activeId ? "block" : "none" }}
          />
        ))}
        {tabs.length === 0 && (
          <div className="empty-state"><div className="big">＋</div>{t("Terminal_EmptyHint")}</div>
        )}
      </div>
      <div
        className={
          "term-doc-splitter" + (docFracDragging ? " dragging" : "") + (docOpen ? "" : " hidden")
        }
        title={t("Terminal_DocResize")}
        onPointerDown={onDocSplitDown}
        onPointerMove={onDocSplitMove}
        onPointerUp={endDocSplitDrag}
        onLostPointerCapture={endDocSplitDrag}
        onDoubleClick={() => {
          applyDocFrac(DOC_FRAC_DEFAULT);
          void updateSettings({ terminalDocFraction: DOC_FRAC_DEFAULT });
        }}
      />
      <div
        className={"doc-panel" + (docFracDragging ? " dragging" : "") + (docOpen ? "" : " closed")}
        style={{ flexBasis: docOpen ? `${(docFrac * 100).toFixed(2)}%` : "0%" }}
      >
        <GitDocPanel onClose={() => setDocOpen(false)} />
      </div>
      </div>
      <div className="term-status">
        <span>{activeStatus}</span>
        <span style={{ marginLeft: "auto" }}>{t("Terminal_CopyHint")}</span>
      </div>
    </>
  );
}

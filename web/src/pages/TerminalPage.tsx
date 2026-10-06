import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { pageSdk, useAppState } from "../pageSdk";
import type { TerminalSessionDTO, ThemeStateDTO } from "../bridge/types";

// R1 宿主面收敛：本页只经 pageSdk 消费宿主（ui-full-pluginization-plan.md R1）
const { call, on: onEvent, t, repo: repoOf, settings: settingsOf, theme: themeOf } = pageSdk;
const useApp = useAppState;

/** 终端页（xterm.js + node-pty，替代 TerminalCanvas/VT 解析器整条自绘链）。 */
export function TerminalPage() {
  const app = useApp();
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<TerminalSessionDTO | null>(null);
  const [status, setStatus] = useState<string>("");
  const [shellKind, setShellKind] = useState(app.settings?.terminalShell ?? "powershell");

  const buildTheme = (theme: ThemeStateDTO | null) => ({
    background: theme?.tokens["Base"] ?? "#1E1F22",
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
  });

  const ensureSession = useCallback(async () => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    const dims = fit.proposeDimensions() ?? { cols: 120, rows: 30 };
    try {
      const follow = settingsOf()?.terminalFollowRepo ?? true;
      const s = await call<TerminalSessionDTO>("terminal.ensure", {
        cols: dims.cols,
        rows: dims.rows,
        cwd: follow ? repoOf()?.workDir ?? null : null,
        shellKind,
      });
      sessionRef.current = s;
      setStatus(`${s.backend} · ${s.shellKind}${s.running ? "" : ` · exit ${s.exitCode ?? "?"}`}`);
    } catch (e) {
      term.writeln(`\r\n\x1b[31m${(e as Error).message}\x1b[0m`);
      setStatus((e as Error).message);
    }
  }, [shellKind]);

  // xterm 生命周期（页面挂载一次；会话由主进程跨页保持）
  useEffect(() => {
    if (!hostRef.current || termRef.current) return;
    const term = new Terminal({
      fontFamily: `${settingsOf()?.terminalFontFamily ?? "Cascadia Mono"}, Consolas, monospace`,
      fontSize: settingsOf()?.terminalFontSize ?? 13,
      cursorBlink: true,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    termRef.current = term;
    fitRef.current = fit;
    term.options.theme = buildTheme(themeOf());
    try { fit.fit(); } catch { /* 未布局时忽略 */ }

    const disposers: (() => void)[] = [];
    disposers.push(
      term.onData((data) => {
        const s = sessionRef.current;
        if (s?.running) void call("terminal.write", { id: s.id, dataB64: btoa(unescape(encodeURIComponent(data))) });
      }).dispose,
    );
    disposers.push(
      onEvent("terminal.data", (p: { id: string; b64: string }) => {
        if (sessionRef.current?.id !== p.id) return;
        const bytes = Uint8Array.from(atob(p.b64), (c) => c.charCodeAt(0));
        term.write(bytes);
      }),
    );
    disposers.push(
      onEvent("terminal.exit", (p: { id: string; exitCode: number }) => {
        if (sessionRef.current?.id !== p.id) return;
        sessionRef.current = { ...sessionRef.current!, running: false, exitCode: p.exitCode };
        setStatus(`exit ${p.exitCode}`);
        term.writeln(`\r\n\x1b[2m[process exited with code ${p.exitCode}]\x1b[0m`);
      }),
    );

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        const dims = fit.proposeDimensions();
        const s = sessionRef.current;
        if (dims && s?.running) void call("terminal.resize", { id: s.id, cols: dims.cols, rows: dims.rows });
      } catch { /* 隐藏时忽略 */ }
    });
    ro.observe(hostRef.current);

    void ensureSession();
    term.focus();

    return () => {
      disposers.forEach((d) => d());
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      sessionRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 跟随仓库：repo 变化重启会话（cwd 语义）
  useEffect(() => {
    if (sessionRef.current) void ensureSession();
  }, [app.repo?.workDir]); // eslint-disable-line react-hooks/exhaustive-deps

  // 主题热切换
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = buildTheme(app.theme);
  }, [app.theme]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="toolbar">
        <select className="input" value={shellKind} onChange={(e) => setShellKind(e.target.value as typeof shellKind)}>
          <option value="powershell">PowerShell</option>
          <option value="cmd">CMD</option>
          <option value="bash">Git Bash</option>
        </select>
        <button className="tool-btn" onClick={() => void ensureSession()}>{t("Terminal_Restart")}</button>
        <span className="grow" />
        <span style={{ fontSize: 11, color: "var(--c-text3)" }}>{status}</span>
      </div>
      <div className="term-wrap" ref={hostRef} />
      <div className="term-status">
        <span>{t("Terminal_CopyHint")}</span>
      </div>
    </>
  );
}

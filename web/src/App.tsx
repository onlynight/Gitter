import { useEffect, useState } from "react";
import { call, onEvent } from "./bridge/client";
import { CommandPalette } from "./components/CommandPalette";
import { Modal } from "./components/Dialogs";
import { Sidebar, StatusBar, TitleBar } from "./components/Shell";
import { applyDiffModeToDom, applyThemeToDom, getState, navigate, reapplyLanguage, reapplyTheme, refreshCurrent, setState, useApp } from "./state/store";
import { BranchesPage } from "./pages/BranchesPage";
import { ChangesPage } from "./pages/ChangesPage";
import { LogPage } from "./pages/LogPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TasksPage } from "./pages/TasksPage";
import { TerminalPage } from "./pages/TerminalPage";

/** 全局快捷键（原 WinUI KeyboardAccelerators 的渲染层版） */
function useShortcuts(openPalette: (prefill?: string) => void) {
  useEffect(() => {
    const order = ["projects", "log", "changes", "branches", "tasks", "bash", "settings"] as const;
    const onKey = (e: KeyboardEvent) => {      const ctrl = e.ctrlKey && !e.altKey;
      if (ctrl && e.shiftKey && (e.key === "P" || e.key === "p")) { e.preventDefault(); openPalette(); return; }
      if (ctrl && !e.shiftKey && (e.key === "P" || e.key === "p")) { e.preventDefault(); openPalette(">"); return; }
      if (ctrl && e.shiftKey && (e.key === "N" || e.key === "n")) { e.preventDefault(); import("./state/store").then((m) => m.routeCommand("branches.create")); return; }
      if (e.key === "F5") { e.preventDefault(); refreshCurrent(); return; }
      if (ctrl && e.key === "Tab") {
        e.preventDefault();
        const order: import("./state/store").PageKey[] = ["projects", "log", "changes", "branches", "tasks", "bash", "settings"];
        const idx = order.indexOf(getState().page);
        navigate(order[(idx + 1 + order.length) % order.length]);
        return;
      }
      if (ctrl && e.key >= "1" && e.key <= "7") {
        e.preventDefault();
        navigate(order[parseInt(e.key, 10) - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPalette]);
}

export function App() {
  const app = useApp();
  const [palette, setPalette] = useState<{ prefill?: string; ts: number } | null>(null);
  const [mcpApproval, setMcpApproval] = useState<{ id: string; description: string; repo: string } | null>(null);

  // MCP 写操作人审卡（McpPipeHost.requestApproval 的 GUI 侧）
  useEffect(
    () =>
      onEvent("mcp.approval", (p: { id: string; description: string; repo: string }) => {
        setMcpApproval(p);
      }),
    [],
  );

  // 启动装配：设置 → 主题 → 语言 → 恢复上次仓库
  useEffect(() => {
    (async () => {
      try {
        const settings = await call<import("./bridge/types").SettingsDTO>("settings.get");
        setState({ settings });
        await reapplyTheme(settings);
        await reapplyLanguage(settings);
        const last = settings.currentProjectPath;
        if (last) {
          try {
            const repo = await call<{ workDir: string; name: string }>("repo.open", { path: last });
            setState({ repo });
          } catch {
            setState({ repo: null });
          }
        }
        setState({ booted: true, page: settings.currentProjectPath ? "log" : "projects" });
      } catch (e) {
        // 桥不可用（纯浏览器调试）：以未开仓库状态进入
        setState({ booted: true, page: "projects" });
        console.error("boot failed:", e);
      }
    })();
  }, []);

  // 设置变化（主题/语言/差异模式）→ 重应用视觉
  useEffect(() => {
    if (app.settings) {
      applyDiffModeToDom(app.settings.diffMode);
    }
    if (app.theme) applyThemeToDom(app.theme);
    if (app.settings?.theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: light)");
      const onChange = () => void reapplyTheme(app.settings!);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
  }, [app.settings?.theme, app.settings?.themePackageId, app.settings?.diffMode, app.theme]);

  // 主进程请求打开仓库（新窗口 / second-instance）
  useEffect(() =>
    onEvent("app.openRepo", async (p: { path: string }) => {
      try {
        const repo = await call<{ workDir: string; name: string }>("repo.open", { path: p.path });
        setState({ repo, page: "log" });
        refreshCurrent();
      } catch (e) {
        console.error("openRepo failed:", e);
      }
    }),
  []);

  useShortcuts((prefill) => setPalette({ prefill, ts: Date.now() }));

  // 标题栏面板按钮（CustomEvent 桥）
  useEffect(() => {
    const open = () => setPalette({ ts: Date.now() });
    window.addEventListener("gitter:palette", open);
    return () => window.removeEventListener("gitter:palette", open);
  }, []);

  if (!app.booted) {
    return (
      <div className="app">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, color: "var(--c-text3)" }}>
          Gitter…
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <TitleBar />
      <div className={"main" + (app.settings?.sidebarCollapsed ? " collapsed" : "")}>
        <Sidebar />
        <div className="page">
          {app.page === "projects" && <ProjectsPage />}
          {app.page === "log" && <LogPage />}
          {app.page === "changes" && <ChangesPage />}
          {app.page === "branches" && <BranchesPage />}
          {app.page === "tasks" && <TasksPage />}
          {app.page === "bash" && <TerminalPage />}
          {app.page === "settings" && <SettingsPage />}
        </div>
      </div>
      <StatusBar />
      {palette && <CommandPalette prefill={palette.prefill} onClose={() => setPalette(null)} />}
      {mcpApproval && (
        <Modal
          title="Agent 写操作确认"
          confirmText="允许"
          cancelText="拒绝"
          danger
          onClose={() => {
            void call("mcp.approve", { id: mcpApproval.id, ok: false });
            setMcpApproval(null);
          }}
          onConfirm={() => {
            void call("mcp.approve", { id: mcpApproval.id, ok: true });
            setMcpApproval(null);
          }}
        >
          <div style={{ userSelect: "text" }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--c-text2)", marginBottom: 6 }}>{mcpApproval.repo}</div>
            {mcpApproval.description}
          </div>
        </Modal>
      )}
    </div>
  );
}

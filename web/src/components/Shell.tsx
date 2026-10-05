import { useEffect, useState } from "react";
import { call, isMaximized, onEvent, winAction } from "../bridge/client";
import { navigate, t, useApp, type PageKey } from "../state/store";

export function TitleBar() {
  const { repo, settings } = useApp();
  const [maxed, setMaxed] = useState(false);
  useEffect(() => {
    isMaximized().then(setMaxed);
    return onEvent("win.maximized", (p: { value: boolean }) => setMaxed(p.value));
  }, []);
  const title = repo
    ? t("Main_WindowTitle", repo.name)
    : "GitUI";
  return (
    <div className="titlebar">
      <button
        className="tb-hamburger"
        title={t("Common_ToggleSidebar")}
        onClick={() => settings && call("settings.set", { patch: { sidebarCollapsed: !settings.sidebarCollapsed } })}
      >
        ☰
      </button>
      <span className="tb-title">{title}</span>
      <span className="tb-spacer" />
      <button className="tb-palette" onClick={() => window.dispatchEvent(new CustomEvent("gitter:palette"))}>
        {t("Palette_Title")} <kbd>Ctrl+Shift+P</kbd>
      </button>
      <button className="tb-btn" onClick={() => winAction("min")}>─</button>
      <button className="tb-btn" onClick={() => winAction("max")}>{maxed ? "❐" : "☐"}</button>
      <button className="tb-btn close" onClick={() => winAction("close")}>✕</button>
    </div>
  );
}

const NAV: { key: PageKey; icon: string; labelKey: string }[] = [
  { key: "projects", icon: "📁", labelKey: "Nav_Projects" },
  { key: "log", icon: "⏱", labelKey: "Nav_Log" },
  { key: "changes", icon: "◇", labelKey: "Nav_Changes" },
  { key: "branches", icon: "⑂", labelKey: "Nav_Branches" },
  { key: "tasks", icon: "🗂", labelKey: "Nav_Tasks" },
  { key: "bash", icon: "▮", labelKey: "Nav_Terminal" },
  { key: "settings", icon: "⚙", labelKey: "Nav_Settings" },
];

export function Sidebar() {
  const { page, settings } = useApp();
  const collapsed = settings?.sidebarCollapsed ?? false;
  return (
    <div className={"sidebar" + (collapsed ? " collapsed" : "")}>
      {NAV.map((n) => (
        <button
          key={n.key}
          className={"nav-item" + (page === n.key ? " active" : "")}
          onClick={() => navigate(n.key)}
          title={t(n.labelKey)}
        >
          <span className="nav-ico">{n.icon}</span>
          <span className="nav-label">{t(n.labelKey)}</span>
        </button>
      ))}
    </div>
  );
}

export function StatusBar() {
  const { repo } = useApp();
  return (
    <div className="statusbar">
      <span className="sb-repo">
        {repo ? `${repo.name} · ${repo.workDir}` : t("Common_NoProjectSelected")}
      </span>
      <span>{t("Main_StatusHint")}</span>
    </div>
  );
}

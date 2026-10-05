import { useEffect, useState } from "react";
import { call, isMaximized, onEvent, winAction } from "../bridge/client";
import { navigate, t, updateSettings, useApp, type PageKey } from "../state/store";

export function TitleBar() {
  const { repo, settings } = useApp();
  const [maxed, setMaxed] = useState(false);
  useEffect(() => {
    isMaximized().then(setMaxed);
    return onEvent("win.maximized", (p: { value: boolean }) => setMaxed(p.value));
  }, []);
  const title = repo ? t("Main_WindowTitle", repo.name) : "GitUI";
  return (
    <div className="titlebar">
      <button
        className="tb-hamburger"
        title={t("Common_ToggleSidebar")}
        onClick={() => void updateSettings({ sidebarCollapsed: !(settings?.sidebarCollapsed ?? false) })}
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

// 侧边栏图标 = WinUI 实现的逐一移植（MainWindow.BuildNavItem 的 items 表）：
// SVG path 为 design-mockups 的 16×16 内联图形；字形项用 Segoe Fluent Icons（WinUI 同码位）。
const NAV: { key: PageKey; glyph?: string; svg?: string; labelKey: string }[] = [
  { key: "projects", glyph: "\uE8B7", labelKey: "Nav_Projects" },
  {
    key: "log",
    svg: "M2 3h12v1.5H2V3zm0 4.25h8.5v1.5H2v-1.5zM2 11.5h12V13H2v-1.5z",
    labelKey: "Nav_Log",
  },
  {
    key: "changes",
    svg: "M2 4.25 5 8l-3 3.75V4.25zM6 3h1.5v10H6V3zm3 0h5a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9v-1.5h4.5v-7H9V3z",
    labelKey: "Nav_Changes",
  },
  {
    key: "branches",
    svg: "M13.1 3.9a2.3 2.3 0 0 0-3.25 3.25l-.1.1a2.3 2.3 0 0 1-3.25 0L5.4 6.2a2.3 2.3 0 1 0-1.06 1.06l1.1 1.05a3.8 3.8 0 0 0 2.31 1.09v1.2a2.3 2.3 0 1 0 1.5 0V9.4a3.8 3.8 0 0 0 2.31-1.09l.1-.1a2.3 2.3 0 1 0 1.44-4.31z",
    labelKey: "Nav_Branches",
  },
  { key: "tasks", glyph: "\uE7C1", labelKey: "Nav_Tasks" },
  { key: "bash", glyph: "\uE756", labelKey: "Nav_Terminal" },
  { key: "settings", glyph: "\uE713", labelKey: "Nav_Settings" },
];

function NavIcon({ glyph, svg }: { glyph?: string; svg?: string }) {
  if (svg) {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d={svg} fill="currentColor" />
      </svg>
    );
  }
  return <span className="glyph">{glyph}</span>;
}

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
          <span className="nav-ico">
            <NavIcon glyph={n.glyph} svg={n.svg} />
          </span>
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

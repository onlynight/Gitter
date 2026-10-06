import { useEffect, useState } from "react";
import { call, isMaximized, onEvent, winAction } from "../bridge/client";
import type { StatusItemDTO } from "../bridge/types";
import { runCommand } from "../commands";
import { navigate, openSettings, t, updateSettings, useApp, type PageKey } from "../state/store";
import { onUiPagesChanged, uiPages } from "../uiRegistry";

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
// 侧边栏 = 页面注册表驱动（ui-pluginization-plan.md U1a）：内置页身份在 builtinPages.ts，
// 外部页（package 来源）追加在注册表顺序位。图标渲染沿用 NavIcon（SVG/glyph）。
export function NavIcon({ glyph, svg }: { glyph?: string; svg?: string }) {
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
  const [, setPagesTick] = useState(0);
  useEffect(() => onUiPagesChanged(() => setPagesTick((x) => x + 1)), []);
  const extNav = uiPages().filter((x) => x.source === "package");
  const collapsed = settings?.sidebarCollapsed ?? false;
  const NAV = uiPages()
    .filter((x) => x.source === "builtin" && x.id !== "settings")
    .map((x) => ({ key: x.id as PageKey, glyph: x.glyph, svg: x.svg, labelKey: x.titleKey ?? "", title: x.title }));
  // 设置固定在侧栏最下方（不在主导航序列）
  const SETTINGS_NAV = { key: "settings" as PageKey, glyph: "", labelKey: "Nav_Settings" };
  
  // 设置不随导航列表排列，单独固定在侧边栏最下方
  const navButton = (n: { key: PageKey; glyph?: string; svg?: string; labelKey?: string; title?: string; packageId?: string }) => (
    <button
      key={n.key}
      className={"nav-item" + (page === n.key ? " active" : "")}
      onClick={() => navigate(n.key)}
      title={n.labelKey ? t(n.labelKey) : n.title}
    >
      <span className="nav-ico">
        <NavIcon glyph={n.glyph} svg={n.svg} />
      </span>
      <span className="nav-label">{n.labelKey ? t(n.labelKey) : n.title ?? n.key}</span>
    </button>
  );
  return (
    <div className={"sidebar" + (collapsed ? " collapsed" : "")}>
      <div className="nav-top">{NAV.map(navButton)}</div>
      <div className="nav-sep" />
      {extNav.map((x) => (
        <div key={x.id} style={{ display: "flex", alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {navButton({ key: x.id, glyph: x.glyph, labelKey: undefined, title: x.title })}
          </div>
          <button
            className="tool-btn"
            style={{ padding: "0 4px", fontSize: 10 }}
            title="卸载此外部页面"
            onClick={() => openSettings("extensions")}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="nav-sep" />
      {navButton(SETTINGS_NAV)}
    </div>
  );
}

export function StatusBar() {
  const { repo } = useApp();
  const [items, setItems] = useState<StatusItemDTO[]>([]);

  // statusbar 插槽（extension-system-v2.md §16.6 E 阶段）：L2 插件条目
  useEffect(() => {
    let cancelled = false;
    const load = () => void call<StatusItemDTO[]>("ui.statusItems").then((r) => !cancelled && setItems(r));
    void load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="statusbar">
      <span className="sb-repo">
        {repo ? `${repo.name} · ${repo.workDir}` : t("Common_NoProjectSelected")}
      </span>
      {items.map((it) => (
        <span
          key={it.id}
          title={it.tooltip}
          style={{ cursor: it.command ? "pointer" : "default" }}
          onClick={() => it.command && void runCommand({ id: it.command, title: it.text })}
        >
          {it.text}
        </span>
      ))}
      <span>{t("Main_StatusHint")}</span>
    </div>
  );
}

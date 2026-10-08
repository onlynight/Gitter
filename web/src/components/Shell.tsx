import { useEffect, useState } from "react";
import { call, isMaximized, onEvent, winAction } from "../bridge/client";
import type { StatusItemDTO } from "../bridge/types";
import { runCommand } from "../commands";
import { navigate, openSettings, t, updateSettings, useApp, type PageKey } from "../state/store";
import { hasBuiltinProvider, onUiPagesChanged, resolveUiPage, uiPages } from "../uiRegistry";
import { NavIcon } from "../kit";

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

export function Sidebar() {
  const { page, settings } = useApp();
  const [, setPagesTick] = useState(0);
  useEffect(() => onUiPagesChanged(() => setPagesTick((x) => x + 1)), []);
  // 槽位-提供者模型（ui-full-pluginization-plan.md R0-2）：侧栏展示各槽位的胜出提供者。
  // 主导航 = 有宿主内置提供者的槽位（被替换时原位显示替换者的图标/标题，来源标记进 tooltip）；
  // 追加区 = 无内置提供者的纯外部页（带 ✕ 跳扩展管理）。
  const slotOf = (x: { slot?: string; id: string }) => x.slot ?? x.id;
  const slots = uiPages();
  const NAV = slots
    .filter((x) => slotOf(x) !== "settings" && hasBuiltinProvider(slotOf(x)))
    .map((x) => ({
      key: slotOf(x) as PageKey, glyph: x.glyph, svg: x.svg,
      labelKey: x.titleKey ?? "", title: x.title,
      pkg: x.source === "package" ? x.packageId : undefined,
    }));
  const extNav = slots.filter((x) => x.source === "package" && !hasBuiltinProvider(slotOf(x)));
  const collapsed = settings?.sidebarCollapsed ?? false;
  // 设置固定在侧栏最下方（不在主导航序列）；身份取注册表胜出者（可被替换页面包带来新图标）
  const settingsDef = resolveUiPage("settings");
  const SETTINGS_NAV = {
    key: "settings" as PageKey,
    glyph: settingsDef?.glyph ?? "\uE713",
    svg: settingsDef?.svg,
    labelKey: "Nav_Settings",
  };

  const navButton = (n: { key: PageKey; glyph?: string; svg?: string; labelKey?: string; title?: string; pkg?: string }) => {
    const label = n.labelKey ? t(n.labelKey) : n.title ?? n.key;
    return (
      <button
        key={n.key}
        className={"nav-item" + (page === n.key ? " active" : "")}
        onClick={() => navigate(n.key)}
        title={n.pkg ? `${label}（${n.pkg}）` : label}
      >
        <span className="nav-ico">
          <NavIcon glyph={n.glyph} svg={n.svg} />
        </span>
        <span className="nav-label">{label}</span>
      </button>
    );
  };
  return (
    <div className={"sidebar" + (collapsed ? " collapsed" : "")}>
      <div className="nav-top">{NAV.map(navButton)}</div>
      {/* 外部页区块（含上下分隔线）仅在有外部页时渲染——空区块双分隔线是视觉缺陷 */}
      {extNav.length > 0 && (
        <>
          <div className="nav-sep" />
          {extNav.map((x) => (
            <div key={x.id} style={{ display: "flex", alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {navButton({ key: slotOf(x) as PageKey, glyph: x.glyph, svg: x.svg, labelKey: undefined, title: x.title, pkg: x.packageId })}
              </div>
              <button
                className="tool-btn nav-ext-x"
                style={{ padding: "0 4px", fontSize: 10 }}
                title="卸载此外部页面"
                onClick={() => openSettings("extensions")}
              >
                ✕
              </button>
            </div>
          ))}
        </>
      )}
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

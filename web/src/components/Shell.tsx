import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  const title = repo ? t("Main_WindowTitle", repo.name) : "Gitter";
  return (
    <div className="titlebar">
      <button
        className="tb-hamburger"
        title={t("Common_ToggleSidebar")}
        onClick={() => {
          // 折叠/展开动画由 Sidebar 的 collapsed 副作用挂 .main-anim（随宽度实际变化同帧
          // 生效，不再依赖固定时间窗——settings IPC 往返一旦超过固定窗口，宽度变化落在窗外
          // 动画就消失）。常驻过渡会让 Chromium 的 grid 列轨道卡死在旧值，见 styles.css .main 注释。
          void updateSettings({ sidebarCollapsed: !(settings?.sidebarCollapsed ?? false) });
        }}
      >
        ☰
      </button>
      <img className="tb-logo" src="./gitter-logo.svg" alt="Gitter" draggable={false} />
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [, setPagesTick] = useState(0);
  useEffect(() => onUiPagesChanged(() => setPagesTick((x) => x + 1)), []);

  // 展开宽度动态贴合内容（ui-branch-reflog 批）：宽度 = 最宽导航项内容 + 与左侧一致的边距
  // （左：4px 外边距 + 10px 内边距 = 14px，右侧对称），上限 300px，
  // 超出上限由 .nav-label 打点截断。折叠态测量仍准确——scrollWidth 取文本自然宽度。
  // 每次渲染后重测（语言/页面包/字体变化都会经此收敛），图标字体晚到时由 fonts.ready 兜底。
  // 宽度必须与选中项无关：激活项加粗（600）更宽，若按「当前字重」测，选中宽标签页时
  // 栏宽撑开、切走时收窄。故统一按 600 测（克隆探针，见 measure 内注释），非激活项
  // （常规字重）天然留出富余，也顺带消灭「恰满宽 + 取整吞亚像素」造成的尾部省略号。
  // 注意：直接写 .main 内联 grid 列而非改 --sidebar-w 变量——Chromium 对「变量值变化 +
  // grid-template-columns 过渡」存在失效（变量已新值、轨道恒滞后一步）。基础 .main 不挂
  // 过渡（写入瞬时生效）；折叠/展开动画由下方 collapsed 副作用临时挂 .main-anim（见 styles.css）。
  useLayoutEffect(() => {
    const measure = () => {
      const root = rootRef.current;
      if (!root) return;
      let maxLabel = 0;
      // 克隆探针测量（不能原地改字重再读）：系统「减弱动态效果」开启时 * 规则给所有元素
      // transition: all(.01ms)，同步改字重 + 读宽命中的是过渡起始帧（旧字重宽度），加粗测量
      // 整体失效且随上一选中态漂移。克隆是新插入节点、无前态样式，不触发过渡，读到的即是
      // 目标字重（600）的真实自然宽。
      const probe = document.createElement("div");
      probe.setAttribute("aria-hidden", "true");
      probe.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;";
      root.appendChild(probe);
      for (const el of root.querySelectorAll<HTMLElement>(".nav-label")) {
        const clone = document.createElement("span");
        clone.textContent = el.textContent;
        const cs = getComputedStyle(el);
        clone.style.fontSize = cs.fontSize;
        clone.style.fontFamily = cs.fontFamily;
        clone.style.fontWeight = "600"; // 统一按激活态字重测（宽度上界，宽度与选中项解耦）
        probe.appendChild(clone);
        maxLabel = Math.max(maxLabel, clone.offsetWidth);
      }
      probe.remove();
      const extAllowance = root.querySelector(".nav-ext-x") ? 26 : 0; // 外部页行尾 ✕ 钮
      // +4px 安全余量：scrollWidth 取整可吞 ~0.5px 亚像素，flex 链（100%-8 → padding →
      // icon → gap）逐级取整又能吞 ~1px（实测 64 算式只落到 63），零/小余量时恰满宽的
      // 标签会打省略号。4px 覆盖两处损耗且视觉不可辨。
      const w = Math.min(300, Math.max(48, 16 + 10 + maxLabel + 20 + 8 + 4 + extAllowance));
      // 直写 .main 内联 grid 列而非改 --sidebar-w 变量——Chromium 对「变量值变化 +
      // grid-template-columns 过渡」存在失效（变量已新值、轨道恒滞后一步）；内联直写
      // 属直接属性值变化，过渡动画正常。折叠态移除内联，让 .main.collapsed 规则生效。
      const main = document.querySelector<HTMLElement>(".main");
      if (!main) return;
      if (main.classList.contains("collapsed")) main.style.removeProperty("grid-template-columns");
      else main.style.setProperty("grid-template-columns", `${w}px 1fr`);
    };
    measure();
    document.fonts?.ready.then(measure).catch(() => {});
  });
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
  // 折叠/展开动画：collapsed 翻转的同一帧挂 .main-anim（useLayoutEffect 先于绘制，宽度
  // 变化与过渡必然同帧生效，settings IPC 往返多慢都不丢动画），transitionend（+超时兜底，
  // 覆盖 reduced-motion 的 .01ms 过渡 / 动画被打断）后摘除。only-on-flip：首帧与无关
  // 渲染不挂，宽度收敛写入保持瞬时生效。
  const prevCollapsed = useRef(collapsed);
  useLayoutEffect(() => {
    const main = document.querySelector<HTMLElement>(".main");
    if (!main) return;
    if (prevCollapsed.current === collapsed) return;
    prevCollapsed.current = collapsed;
    main.classList.add("main-anim");
    const remove = () => main.classList.remove("main-anim");
    main.addEventListener("transitionend", remove, { once: true });
    const t = window.setTimeout(remove, 400);
    return () => { window.clearTimeout(t); main.removeEventListener("transitionend", remove); main.classList.remove("main-anim"); };
  }, [collapsed]);
  // 设置固定在侧栏最下方（不在主导航序列）；身份取注册表胜出者（可被替换页面包带来新图标）
  const settingsDef = resolveUiPage("settings");
  const SETTINGS_NAV = {
    key: "settings" as PageKey,
    glyph: settingsDef?.glyph ?? "\uE713",
    svg: settingsDef?.svg,
    labelKey: "Nav_Settings",
  };

  // 包 manifest 标题支持 %key% 引用包 i18n/<lang>.json；包常只随 zh-Hans 一篇，
  // 其它语言会露出原始 %...% 键（实测英文态 %Nav_Files%/%Nav_Office%）。
  // %宿主键%（Nav_* 宿主词表 en/zh-Hans 双语齐全）回退宿主 t()；未命中保留原文。
  const navLabel = (n: { key: PageKey; labelKey?: string; title?: string }) => {
    if (n.labelKey) return t(n.labelKey);
    const raw = n.title;
    if (!raw) return n.key;
    const m = /^%(.+)%$/.exec(raw);
    if (!m) return raw;
    const s = t(m[1]);
    return s === m[1] ? raw : s;
  };

  const navButton = (n: { key: PageKey; glyph?: string; svg?: string; labelKey?: string; title?: string; pkg?: string }) => {
    const label = navLabel(n);
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
    <div ref={rootRef} className={"sidebar" + (collapsed ? " collapsed" : "")}>
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

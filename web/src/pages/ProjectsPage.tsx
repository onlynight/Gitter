import { useCallback, useEffect, useState } from "react";
import { pageSdk, useAppState } from "../pageSdk";
import type { ProjectDTO, ProjectsStateDTO } from "../bridge/types";

// R1 宿主面收敛：本页只经 pageSdk 消费宿主（ui-full-pluginization-plan.md R1）
const { call, t, openRepo, closeRepo, refresh: refreshCurrent } = pageSdk;
const useApp = useAppState;

// 查看方式（projects-view-modes-mockup.html）：卡片=现状；平铺/列表/详细信息为纯视图
// 映射，数据同源 projects.list；选择持久化在 localStorage（仅前端、零后端改动）。
type ViewMode = "card" | "tile" | "list" | "details";
const VIEW_KEY = "gitter.projects.view";
const VIEWS: Array<{ id: ViewMode; labelKey: string; glyph: string }> = [
  { id: "card", labelKey: "Projects_ViewCard", glyph: "\uF0E2" },      // GridView
  { id: "tile", labelKey: "Projects_ViewTiles", glyph: "\uECA5" },     // Tiles
  { id: "list", labelKey: "Projects_ViewList", glyph: "\uEA37" },      // List
  { id: "details", labelKey: "Projects_ViewDetails", glyph: "\uE9D5" }, // CheckList
];

function loadViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "tile" || v === "list" || v === "details") return v;
  } catch {
    // localStorage 不可用（隐私模式等）→ 回落卡片，不影响功能
  }
  return "card";
}

export function ProjectsPage() {
  const app = useApp();
  const [state, setStateDto] = useState<ProjectsStateDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>(loadViewMode);

  const reload = useCallback(async () => {
    try {
      setStateDto(await call<ProjectsStateDTO>("projects.list"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [app.refreshTick, reload]);

  const open = async (p: ProjectDTO) => {
    try {
      await openRepo(p.path);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const add = async () => {
    try {
      const p = await call<ProjectDTO | null>("projects.add");
      if (p) await open(p);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (p: ProjectDTO) => {
    await call("projects.remove", { path: p.path });
    closeRepo();
    await reload();
  };

  const switchView = (v: ViewMode) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // 持久化失败不阻断切换
    }
  };

  // 分段切换器 ←→ 循环切换（radiogroup 惯例），视图随焦点项移动
  const onSegKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = VIEWS.findIndex((v) => v.id === view);
    const next = VIEWS[(i + (e.key === "ArrowRight" ? 1 : -1) + VIEWS.length) % VIEWS.length];
    switchView(next.id);
    e.currentTarget.querySelector<HTMLButtonElement>(`button[data-view="${next.id}"]`)?.focus();
  };

  // 行内操作钮（打开/新窗口/移除）：卡片、平铺常显，列表、详细信息悬停显；阻断行点击
  const rowActions = (p: ProjectDTO) => (
    <div className="row-actions" onClick={(e) => e.stopPropagation()}>
      <button className="act" data-tip={t("Projects_Open")} onClick={() => void open(p)}>
        <span className="glyph">{"\uE768"}</span>
      </button>
      <button className="act" data-tip={t("Projects_NewWindow")} onClick={() => void call("app.newWindow", { path: p.path })}>
        <span className="glyph">{"\uE8A7"}</span>
      </button>
      <button className="act danger" data-tip={t("Projects_Remove")} onClick={() => void remove(p)}>
        <span className="glyph">{"\uE74D"}</span>
      </button>
    </div>
  );

  const currentChip = (p: ProjectDTO) =>
    state?.currentPath === p.path ? <span className="chip">{t("Projects_Current")}</span> : null;

  return (
    <>
      <div className="toolbar">
        <button className="tool-btn icon" data-tip={t("Projects_AddProject")} onClick={() => void add()}>
            <span className="glyph">{"\uE710"}</span>
          </button>
        <span className="grow" />
        <span className="view-label">{t(VIEWS.find((v) => v.id === view)!.labelKey)}</span>
        <div className="view-seg" role="radiogroup" aria-label={t("Projects_View")} onKeyDown={onSegKeyDown}>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              data-view={v.id}
              role="radio"
              aria-checked={view === v.id}
              className={view === v.id ? "on" : ""}
              data-tip={t(v.labelKey)}
              onClick={() => switchView(v.id)}
            >
              <span className="glyph">{v.glyph}</span>
            </button>
          ))}
        </div>
      </div>
      {error && <div className="banner error"><span className="banner-text">{error}</span><button className="tool-btn" onClick={() => setError(null)}>✕</button></div>}
      {state && state.projects.length === 0 ? (
        <div className="empty-state">
          <div className="big">📁</div>
          <div>{t("Projects_EmptyHint")}</div>
          <button className="tool-btn icon" data-tip={t("Projects_AddProject")} onClick={() => void add()}>
            <span className="glyph">{"\uE710"}</span>
          </button>
        </div>
      ) : view === "card" ? (
        <div className="card-grid">
          {state?.projects.map((p) => (
            <div key={p.path} className="card" onClick={() => void open(p)}>
              <div className="card-title">
                📁 {p.name}
                {currentChip(p)}
              </div>
              <div className="card-path">{p.path}</div>
              <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                <button className="tool-btn icon sm" data-tip={t("Projects_Open")} onClick={() => void open(p)}>
                  <span className="glyph" style={{ fontSize: 11 }}>{"\uE768"}</span>
                </button>
                <button className="tool-btn icon sm" data-tip={t("Projects_NewWindow")} onClick={() => void call("app.newWindow", { path: p.path })}>
                  <span className="glyph" style={{ fontSize: 11 }}>{"\uE8A7"}</span>
                </button>
                <button
                  className="tool-btn icon sm"
                  data-tip={t("Projects_Remove")}
                  style={{ color: "var(--c-red)" }}
                  onClick={() => void remove(p)}
                >
                  <span className="glyph" style={{ fontSize: 11 }}>{"\uE74D"}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : view === "tile" ? (
        <div className="tile-grid">
          {state?.projects.map((p) => (
            <div key={p.path} className="tile" onClick={() => void open(p)}>
              <span className="t-ico">📁</span>
              <div className="t-main">
                <div className="t-name">
                  <span className="nm">{p.name}</span>
                  {currentChip(p)}
                </div>
                <div className="t-path">{p.path}</div>
              </div>
              {rowActions(p)}
            </div>
          ))}
        </div>
      ) : view === "list" ? (
        <div className="proj-list">
          {state?.projects.map((p) => (
            <div key={p.path} className="lrow" onClick={() => void open(p)}>
              <span className="l-ico">📁</span>
              <span className="nm">{p.name}</span>
              {currentChip(p)}
              <span className="pth">{p.path}</span>
              {rowActions(p)}
            </div>
          ))}
        </div>
      ) : (
        <div className="proj-details">
          <div className="dhead">
            <span>{t("Projects_ColName")}</span>
            <span>{t("Projects_ColPath")}</span>
            <span className="dh-last">{t("Projects_ColActions")}</span>
          </div>
          {state?.projects.map((p) => (
            <div key={p.path} className="drow" onClick={() => void open(p)}>
              <span className="nm">
                <span>📁</span>
                <span className="t">{p.name}</span>
                {currentChip(p)}
              </span>
              <span className="pth">{p.path}</span>
              {rowActions(p)}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

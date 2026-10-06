import { useCallback, useEffect, useState } from "react";
import { pageSdk, useAppState } from "../pageSdk";
import type { ProjectDTO, ProjectsStateDTO } from "../bridge/types";

// R1 宿主面收敛：本页只经 pageSdk 消费宿主（ui-full-pluginization-plan.md R1）
const { call, t, openRepo, closeRepo, refresh: refreshCurrent } = pageSdk;
const useApp = useAppState;

export function ProjectsPage() {
  const app = useApp();
  const [state, setStateDto] = useState<ProjectsStateDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <>
      <div className="toolbar">
        <button className="tool-btn icon" data-tip={t("Projects_AddProject")} onClick={() => void add()}>
            <span className="glyph">{""}</span>
          </button>
        <span className="grow" />
      </div>
      {error && <div className="banner error"><span className="banner-text">{error}</span><button className="tool-btn" onClick={() => setError(null)}>✕</button></div>}
      {state && state.projects.length === 0 ? (
        <div className="empty-state">
          <div className="big">📁</div>
          <div>{t("Projects_EmptyHint")}</div>
          <button className="tool-btn icon" data-tip={t("Projects_AddProject")} onClick={() => void add()}>
            <span className="glyph">{""}</span>
          </button>
        </div>
      ) : (
        <div className="card-grid">
          {state?.projects.map((p) => (
            <div key={p.path} className="card" onClick={() => void open(p)}>
              <div className="card-title">
                📁 {p.name}
                {state.currentPath === p.path && <span className="chip">{t("Projects_Current")}</span>}
              </div>
              <div className="card-path">{p.path}</div>
              <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                <button className="tool-btn icon sm" data-tip={t("Projects_Open")} onClick={() => void open(p)}>
                  <span className="glyph" style={{ fontSize: 11 }}>{""}</span>
                </button>
                <button className="tool-btn icon sm" data-tip={t("Projects_NewWindow")} onClick={() => void call("app.newWindow", { path: p.path })}>
                  <span className="glyph" style={{ fontSize: 11 }}>{""}</span>
                </button>
                <button
                  className="tool-btn icon sm"
                  data-tip={t("Projects_Remove")}
                  style={{ color: "var(--c-red)" }}
                  onClick={async () => { await call("projects.remove", { path: p.path }); closeRepo(); await reload(); }}
                >
                  <span className="glyph" style={{ fontSize: 11 }}>{""}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

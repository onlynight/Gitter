import { useCallback, useEffect, useState } from "react";
import { call } from "../bridge/client";
import { Modal } from "../components/Dialogs";
import type { WorktreeDTO } from "../bridge/types";
import { refreshCurrent, setState, t, useApp } from "../state/store";

/** 任务页（worktree 任务卡，ai-native-redesign.md §六的 v1 形态）。 */
export function TasksPage() {
  const app = useApp();
  const repo = app.repo;
  const [worktrees, setWorktrees] = useState<WorktreeDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transient, setTransient] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [taskName, setTaskName] = useState("");

  const reload = useCallback(async () => {
    if (!repo) return;
    try {
      setWorktrees(await call<WorktreeDTO[]>("tasks.list"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [repo]);

  useEffect(() => {
    void reload();
  }, [repo, app.refreshTick]);

  const open = (w: WorktreeDTO) => {
    setState({ repo: { workDir: w.path, name: w.path.split(/[\\/]/).pop() ?? w.path }, page: "log" });
    refreshCurrent();
  };

  if (!repo) {
    return <div className="empty-state"><div className="big">🗂</div>{t("Common_NoProjectSelected")}</div>;
  }

  return (
    <>
      <div className="toolbar">
        <button className="tool-btn primary" onClick={() => setCreating(true)}>{t("Tasks_Create")}</button>
        <span className="grow" />
        {transient && <span style={{ fontSize: 11, color: "var(--c-green)" }}>{transient}</span>}
      </div>
      {error && <div className="banner error"><span className="banner-text">{error}</span><button className="tool-btn" onClick={() => setError(null)}>✕</button></div>}
      <div className="card-grid">
        {worktrees?.map((w) => (
          <div key={w.path} className="card" onClick={() => !w.isMain && open(w)}>
            <div className="card-title">
              🗂 {w.branch || w.path.split(/[\\/]/).pop()}
              {w.isMain && <span className="chip">{t("Tasks_MainWorktree")}</span>}
              {w.isCurrent && <span className="chip">{t("Tasks_Current")}</span>}
            </div>
            <div className="card-path">{w.path}</div>
            <div className="card-path">{w.head.slice(0, 10)}</div>
            <div className="card-actions" onClick={(e) => e.stopPropagation()}>
              {!w.isMain && <button className="tool-btn" onClick={() => open(w)}>{t("Tasks_Open")}</button>}
              <button className="tool-btn" onClick={() => void call("app.newWindow", { path: w.path })}>{t("Projects_NewWindow")}</button>
              {!w.isMain && (
                <button
                  className="tool-btn"
                  onClick={async () => {
                    try {
                      await call("tasks.remove", { path: w.path });
                      setTransient(t("Tasks_Removed"));
                      await reload();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {t("Tasks_Remove")}
                </button>
              )}
            </div>
          </div>
        ))}
        {worktrees?.length === 0 && <div className="empty-state">{t("Tasks_EmptyHint")}</div>}
      </div>

      {creating && (
        <Modal
          title={t("Tasks_CreateTitle")}
          confirmText={t("Common_Create")}
          confirmDisabled={!taskName.trim()}
          onClose={() => setCreating(false)}
          onConfirm={async () => {
            try {
              await call("tasks.create", { name: taskName.trim() });
              setCreating(false);
              setTaskName("");
              setTransient(t("Tasks_Created"));
              await reload();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <input
            autoFocus
            className="input"
            style={{ width: "100%" }}
            placeholder={t("Tasks_NamePlaceholder")}
            value={taskName}
            onChange={(e) => setTaskName(e.target.value)}
          />
        </Modal>
      )}
    </>
  );
}

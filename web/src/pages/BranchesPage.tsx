import { useCallback, useEffect, useState } from "react";
import { pageSdk, useAppState } from "../pageSdk";
import { seamMenuItems } from "../commands";
import { Modal, useContextMenu, SyncBar, useSyncProgress, type CtxMenuItem } from "../kit";
import type { BranchesStateDTO, DeletePreviewDTO } from "../bridge/types";

// R1 宿主面收敛：本页只经 pageSdk 消费宿主（ui-full-pluginization-plan.md R1）
const { call, t, refresh: refreshCurrent, openSettings } = pageSdk;
const useApp = useAppState;

/** 推送无上游类错误的识别（git 2.37+ 提示语 + 旧版提示语都覆盖）。 */
function isNoUpstreamError(msg: string | null): boolean {
  if (!msg) return false;
  return /push\.autoSetupRemote|set-upstream|no upstream|上游/i.test(msg);
}

export function BranchesPage() {
  const app = useApp();
  const repo = app.repo;
  const [state, setState] = useState<BranchesStateDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transient, setTransient] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<{ name: string; isRemote: boolean } | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: "create"; name: string }
    | { kind: "rename"; oldName: string; newName: string }
    | { kind: "deletePreview"; name: string; preview: DeletePreviewDTO | null }
    | { kind: "merge"; name: string; noFf: boolean; message: string }
    | null
  >(null);
  const { showMenu, menuElement } = useContextMenu();
  const [syncProgress, clearSyncProgress] = useSyncProgress();

  const reload = useCallback(async () => {
    if (!repo) return;
    try {
      setState(await call<BranchesStateDTO>("branches.state"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [repo]);

  useEffect(() => {
    void reload();
  }, [repo, app.refreshTick]);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      setTransient(await fn());
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      clearSyncProgress();
      setBusy(false);
    }
  };

  const branchMenu = (name: string, isRemote: boolean): CtxMenuItem[] => {
    if (isRemote) {
      return [
        { label: t("Branches_FastForward"), action: () => void run(async () => { await call("branches.ff", { name }); return t("Branches_FastForwarded"); }) },
      ];
    }
    const isCurrent = state?.current === name;
    return [
      ...(isCurrent ? [] : [{ label: t("Branches_Checkout"), action: () => void run(async () => { await call("branches.checkout", { name }); return t("Branches_CheckedOut", name); }) }]),
      { label: t("Branches_Rename"), action: () => setDialog({ kind: "rename", oldName: name, newName: name }) },
      { sep: true, label: "", action: () => {} },
      { label: t("Branches_Merge"), action: () => setDialog({ kind: "merge", name, noFf: false, message: "" }) },
      { label: t("Branches_MergeNoFf"), action: () => setDialog({ kind: "merge", name, noFf: true, message: "" }) },
      { label: t("Branches_Rebase"), action: () => void run(async () => { await call("branches.rebase", { name }); return t("Branches_Rebased", name); }) },
      { sep: true, label: "", action: () => {} },
      { label: t("Branches_Delete"), action: () => void (async () => {
          try {
            const preview = await call<DeletePreviewDTO>("branches.deletePreview", { name });
            setDialog({ kind: "deletePreview", name, preview });
          } catch (e) {
            setError((e as Error).message);
          }
        })() },
    ];
  };

  if (!repo) {
    return <div className="empty-state"><div className="big">⑂</div>{t("Common_NoProjectSelected")}</div>;
  }

  const renderGroup = (title: string, remote: boolean) => {
    const list = remote ? state?.remote ?? [] : state?.local ?? [];
    if (list.length === 0) return null;
    return (
      <>
        <div className="pane-card" style={{ marginBottom: 12, display: "block" }}>
        <div className="group-header"><span>{title}</span><span style={{ color: "var(--c-text3)", fontWeight: 400 }}>{list.length}</span></div>
        {list.map((b) => (
          <div
            key={b.name}
            className={"list-row" + (selected?.name === b.name ? " selected" : "")}
            onClick={() => setSelected({ name: b.name, isRemote: remote })}
            onContextMenu={(e) => {
              setSelected({ name: b.name, isRemote: remote });
              void (async () => {
                showMenu(e, [...branchMenu(b.name, remote), ...(await seamMenuItems("branchRow"))]);
              })();
            }}
          >
            <span className="mono">{b.shortSha}</span>
            <span className="trim" style={{ flex: 1 }}>
              {b.name}
              {state?.current === b.name && <span className="badge" style={{ marginLeft: 6 }}>HEAD</span>}
            </span>
            <span className="trim" style={{ color: "var(--c-text3)", fontSize: 11, maxWidth: 260 }}>{b.subject}</span>
          </div>
        ))}
        </div>
      </>
    );
  };

  return (
    <>
      <div className="toolbar">
        <button className="tool-btn icon" data-tip={t("Branches_Create")} onClick={() => setDialog({ kind: "create", name: "" })}>
          <span className="glyph">{""}</span>
        </button>
        <span className="grow" />
        <button className="tool-btn icon" data-tip={t("Branches_Pull")} disabled={busy} onClick={() => void run(async () => { await call("branches.pull", { rebase: false }); return t("Branches_Pulled"); })}>
          <span className="glyph">{""}</span>
        </button>
        <button className="tool-btn icon" data-tip={t("Branches_PullRebase")} disabled={busy} onClick={() => void run(async () => { await call("branches.pull", { rebase: true }); return t("Branches_PulledRebase"); })}>
          <span className="glyph">{""}</span>
        </button>
        <button className="tool-btn icon" data-tip={t("Branches_Push")} disabled={busy} onClick={() => void run(async () => { await call("branches.push", {}); return t("Branches_Pushed"); })}>
          <span className="glyph">{""}</span>
        </button>
      </div>

      {error && (
        <div className="banner error">
          <span className="banner-text">{error}</span>
          {isNoUpstreamError(error) && (
            <button className="tool-btn" onClick={() => openSettings("git")}>{t("Common_GoToSettings")}</button>
          )}
          <button className="tool-btn" onClick={() => setError(null)}>✕</button>
        </div>
      )}
      {transient && <div className="banner"><span className="banner-text">{transient}</span><button className="tool-btn" onClick={() => setTransient(null)}>✕</button></div>}
      {busy && <SyncBar progress={syncProgress} />}

      <div
        className="split-pane"
        style={{ flex: 1, minHeight: 0, overflow: "auto", margin: "10px 12px 12px", background: "transparent", border: "none", borderRadius: 0 }}
      >
        {state ? (
          <>
            {renderGroup(t("Branches_LocalGroup"), false)}
            {renderGroup(t("Branches_RemoteGroup"), true)}
          </>
        ) : (
          <div className="empty-state">{t("Common_Loading")}</div>
        )}
      </div>

      {dialog?.kind === "create" && (
        <Modal
          title={t("Branches_CreateTitle")}
          confirmText={t("Common_Create")}
          confirmDisabled={!dialog.name.trim()}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            const name = dialog.name.trim();
            void run(async () => { await call("branches.create", { name }); return t("Branches_Created", name); });
            setDialog(null);
          }}
        >
          <input autoFocus className="input" style={{ width: "100%" }} placeholder={t("Branches_NamePlaceholder")}
            value={dialog.name} onChange={(e) => setDialog({ ...dialog, name: e.target.value })} />
        </Modal>
      )}
      {dialog?.kind === "rename" && (
        <Modal
          title={t("Branches_RenameTitle")}
          confirmText={t("Common_Rename")}
          confirmDisabled={!dialog.newName.trim() || dialog.newName === dialog.oldName}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            void run(async () => { await call("branches.rename", { oldName: dialog.oldName, newName: dialog.newName.trim() }); return t("Branches_Renamed"); });
            setDialog(null);
          }}
        >
          <input autoFocus className="input" style={{ width: "100%" }} value={dialog.newName}
            onChange={(e) => setDialog({ ...dialog, newName: e.target.value })} />
        </Modal>
      )}
      {dialog?.kind === "deletePreview" && (
        <Modal
          title={t("Branches_DeleteTitle", dialog.name)}
          confirmText={t("Common_Delete")}
          danger
          onClose={() => setDialog(null)}
          onConfirm={() => {
            void run(async () => { await call("branches.delete", { name: dialog.name, force: dialog.preview?.forceRequired }); return t("Branches_Deleted", dialog.name); });
            setDialog(null);
          }}
        >
          <div>
            {dialog.preview?.forceRequired
              ? t("Branches_DeleteLoseWarning", dialog.preview.lostCount) + " " +
                dialog.preview.lostSamples.map((c) => c.shortSha).join(", ")
              : t("Branches_DeleteSafe", dialog.name)}
          </div>
        </Modal>
      )}
      {dialog?.kind === "merge" && (
        <Modal
          title={t("Branches_MergeTitle", dialog.name)}
          confirmText={t("Common_Merge")}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            void run(async () => { await call("branches.merge", { name: dialog.name, noFf: dialog.noFf, message: dialog.message || null }); return t("Branches_Merged", dialog.name); });
            setDialog(null);
          }}
        >
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={dialog.noFf} onChange={(e) => setDialog({ ...dialog, noFf: e.target.checked })} />
            {t("Branches_NoFastForward")}
          </label>
          <input className="input" style={{ width: "100%" }} placeholder={t("Branches_MergeMessagePlaceholder")}
            value={dialog.message} onChange={(e) => setDialog({ ...dialog, message: e.target.value })} />
        </Modal>
      )}
      {menuElement}
    </>
  );
}


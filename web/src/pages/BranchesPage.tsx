import { useCallback, useEffect, useState } from "react";
import { pageSdk, useAppState } from "../pageSdk";
import { seamMenuItems } from "../commands";
import { Modal, Select, ReflogDialog, useContextMenu, SyncBar, useSyncProgress, Banner, type CtxMenuItem, type SelectOption } from "../kit";
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
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [transient, setTransient] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<{ kind: "local" | "remote" | "tag"; name: string } | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: "create"; name: string; startPoint: string; startPointTab: "branch" | "tag"; checkout: boolean }
    | { kind: "rename"; oldName: string; newName: string }
    | { kind: "deletePreview"; name: string; preview: DeletePreviewDTO | null }
    | { kind: "deleteRemote"; name: string }
    | { kind: "deleteTag"; name: string }
    | { kind: "reflog"; name: string }
    | { kind: "merge"; source: string; target: string; noFf: boolean; message: string }
    | null
  >(null);
  const { showMenu, menuElement } = useContextMenu();
  const [syncProgress, clearSyncProgress] = useSyncProgress();

  const reload = useCallback(async () => {
    if (!repo) return;
    try {
      setState(await call<BranchesStateDTO>("branches.state"));
      setError(null);
      setErrorDetail(null);
    } catch (e) {
      setError((e as Error).message);
      setErrorDetail((e as { detail?: string }).detail ?? null);
    }
  }, [repo]);

  useEffect(() => {
    void reload();
  }, [repo, app.refreshTick]);

  // 命令面板/菜单的 branches.create 路由到本页：打开创建对话框
  useEffect(() => {
    if (app.routedCommand?.id === "branches.create") {
      setDialog({ kind: "create", name: "", startPoint: "HEAD", startPointTab: "branch", checkout: true });
    }
  }, [app.routedCommand]);

  /** 创建起点候选：HEAD / 本地分支 / 远程分支 / tag。value 用全限定 refname 避免分支与 tag 同名歧义。 */
  const startPointOptions = (): SelectOption[] => {
    const cur = state?.current ?? null;
    return [
      // 钉住项：置顶、不受搜索过滤（默认起点永远可选）
      { value: "HEAD", label: t("Branches_StartHead", cur ?? "HEAD"), tab: "branch", pinned: true, triggerBadge: "head" as const, keywords: `head ${cur ?? ""}` },
      ...(state?.local ?? []).filter((b) => b.name !== cur).map((b) => ({ value: "refs/heads/" + b.name, label: b.name, group: t("Branches_LocalGroup"), tab: "branch", triggerBadge: "branch" as const })),
      ...(state?.remote ?? []).map((b) => ({ value: "refs/remotes/" + b.name, label: b.name, group: t("Branches_RemoteGroup"), tab: "branch", triggerBadge: "branch" as const })),
      ...(state?.tags ?? []).map((tg) => ({ value: "refs/tags/" + tg.name, label: tg.name, group: t("Branches_TagGroup"), tab: "tag", badge: t("Branches_TagSuffix"), hint: tg.shortSha || undefined, triggerBadge: "tag" as const })),
    ];
  };

  /** 起点值的类型归属（HEAD/分支 → branch；refs/tags/ → tag） */
  const startPointType = (v: string): "branch" | "tag" => (v.startsWith("refs/tags/") ? "tag" : "branch");

  const mergeSourceOptions = (): SelectOption[] => [
    ...(state?.local ?? []).map((b) => ({ value: "refs/heads/" + b.name, label: b.name })),
    ...(state?.remote ?? []).map((b) => ({ value: "refs/remotes/" + b.name, label: b.name })),
  ];

  /** 合并目标只能是本地分支（远程跟踪分支不可检出为工作分支）。 */
  const mergeTargetOptions = (): SelectOption[] => (state?.local ?? []).map((b) => ({ value: b.name, label: b.name }));

  const tagMenu = (name: string): CtxMenuItem[] => [
    { label: t("Branches_CreateBranchFromTag"), action: () => setDialog({ kind: "create", name: "", startPoint: "refs/tags/" + name, startPointTab: "tag", checkout: true }) },
    { sep: true, label: "", action: () => {} },
    { label: t("Branches_DeleteTag"), action: () => setDialog({ kind: "deleteTag", name }) },
  ];

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      setTransient(await fn());
      await reload();
    } catch (e) {
      setError((e as Error).message);
      setErrorDetail((e as { detail?: string }).detail ?? null);
    } finally {
      clearSyncProgress();
      setBusy(false);
    }
  };

  const branchMenu = (name: string, isRemote: boolean): CtxMenuItem[] => {
    if (isRemote) {
      return [
        { label: t("Branches_CheckoutLocal"), action: () => void run(async () => {
            const local = await call<string>("branches.checkoutRemote", { name });
            return t("Branches_CheckedOut", local);
          }) },
        { label: t("Branches_FastForward"), action: () => void run(async () => { await call("branches.ff", { name }); return t("Branches_FastForwarded"); }) },
        { sep: true, label: "", action: () => {} },
        { label: t("Branches_DeleteRemote"), action: () => setDialog({ kind: "deleteRemote", name }) },
      ];
    }
    const isCurrent = state?.current === name;
    return [
      ...(isCurrent ? [] : [{ label: t("Branches_Checkout"), action: () => void run(async () => { await call("branches.checkout", { name }); return t("Branches_CheckedOut", name); }) }]),
      { label: t("Branches_Rename"), action: () => setDialog({ kind: "rename", oldName: name, newName: name }) },
      { label: t("Reflog_View"), action: () => setDialog({ kind: "reflog", name }) },
      { sep: true, label: "", action: () => {} },
      { label: t("Branches_Merge"), action: () => setDialog({ kind: "merge", source: "refs/heads/" + name, target: state?.current ?? state?.local?.[0]?.name ?? "", noFf: false, message: "" }) },
      { label: t("Branches_Rebase"), action: () => void run(async () => { await call("branches.rebase", { name }); return t("Branches_Rebased", name); }) },
      { sep: true, label: "", action: () => {} },
      { label: t("Branches_Delete"), action: () => void (async () => {
          try {
            const preview = await call<DeletePreviewDTO>("branches.deletePreview", { name });
            setDialog({ kind: "deletePreview", name, preview });
          } catch (e) {
            setError((e as Error).message);
            setErrorDetail((e as { detail?: string }).detail ?? null);
          }
        })() },
    ];
  };

  if (!repo) {
    return <div className="empty-state"><div className="big">⑂</div>{t("Common_NoProjectSelected")}</div>;
  }

  const groupHeader = (title: string, count: number) => (
    <div className="group-header solid"><span>{title}</span><span style={{ color: "var(--c-text3)", fontWeight: 400 }}>{count}</span></div>
  );

  const renderBranchRows = (remote: boolean) =>
    (remote ? state?.remote ?? [] : state?.local ?? []).map((b) => (
      <div
        key={b.name}
        className={"list-row" + (selected?.kind === (remote ? "remote" : "local") && selected?.name === b.name ? " selected" : "")}
        onClick={() => setSelected({ kind: remote ? "remote" : "local", name: b.name })}
        onContextMenu={(e) => {
          setSelected({ kind: remote ? "remote" : "local", name: b.name });
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
        <span className="trim" style={{ color: "var(--c-text3)", fontSize: 11, maxWidth: 180 }}>{b.subject}</span>
      </div>
    ));

  const renderTagRows = () =>
    (state?.tags ?? []).map((tg) => (
      <div
        key={tg.name}
        className={"list-row" + (selected?.kind === "tag" && selected?.name === tg.name ? " selected" : "")}
        onClick={() => setSelected({ kind: "tag", name: tg.name })}
        onContextMenu={(e) => {
          setSelected({ kind: "tag", name: tg.name });
          showMenu(e, tagMenu(tg.name));
        }}
      >
        <span className="mono">{tg.shortSha}</span>
        <span className="trim" style={{ flex: 1 }}>{tg.name}</span>
        <span className="trim" style={{ color: "var(--c-text3)", fontSize: 11, maxWidth: 140 }}>{tg.subject}</span>
      </div>
    ));

  return (
    <>
      <div className="toolbar">
        <button className="tool-btn icon" data-tip={t("Branches_Create")} onClick={() => setDialog({ kind: "create", name: "", startPoint: "HEAD", startPointTab: "branch", checkout: true })}>
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
        <Banner
          text={error}
          detail={errorDetail ?? undefined}
          error
          onCopyDetail={errorDetail ? () => navigator.clipboard.writeText(errorDetail) : undefined}
          onClose={() => { setError(null); setErrorDetail(null); }}
          actions={isNoUpstreamError(error) ? [{ label: t("Common_GoToSettings"), onClick: () => openSettings("git") }] : undefined}
        />
      )}
      {transient && <div className="banner"><span className="banner-text">{transient}</span><button className="tool-btn" onClick={() => setTransient(null)}>✕</button></div>}
      {busy && <SyncBar progress={syncProgress} />}

      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 12, margin: "10px 12px 12px" }}>
        {/* 左栏：本地 + 远程分支 */}
        <div className="pane-card" style={{ flex: 1.7, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {state ? (
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {groupHeader(t("Branches_LocalGroup"), state.local.length)}
              {renderBranchRows(false)}
              <div style={{ height: 8 }} />
              {groupHeader(t("Branches_RemoteGroup"), state.remote.length)}
              {renderBranchRows(true)}
            </div>
          ) : (
            <div className="empty-state" style={{ flex: 1 }}>{t("Common_Loading")}</div>
          )}
        </div>
        {/* 右栏：tag */}
        <div className="pane-card" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {state ? (
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {groupHeader(t("Branches_TagGroup"), state.tags.length)}
              {state.tags.length > 0 ? renderTagRows() : (
                <div style={{ padding: "14px 12px", color: "var(--c-text3)", fontSize: 12 }}>{t("Branches_NoTags")}</div>
              )}
            </div>
          ) : (
            <div className="empty-state" style={{ flex: 1 }}>{t("Common_Loading")}</div>
          )}
        </div>
      </div>

      {dialog?.kind === "create" && (
        <Modal
          title={t("Branches_CreateTitle")}
          confirmText={t("Common_Create")}
          confirmDisabled={!dialog.name.trim() || !dialog.startPoint}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            const name = dialog.name.trim();
            const from = dialog.startPoint === "HEAD" ? null : dialog.startPoint;
            void run(async () => { await call("branches.create", { name, fromSha: from, checkout: dialog.checkout }); return t("Branches_Created", name); });
            setDialog(null);
          }}
        >
          <input autoFocus className="input" style={{ width: "100%" }} placeholder={t("Branches_NamePlaceholder")}
            value={dialog.name} onChange={(e) => setDialog({ ...dialog, name: e.target.value })} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ color: "var(--c-text3)", fontSize: 12 }}>{t("Branches_StartPoint")}</span>
            <Select
              className="full" style={{ width: "100%" }}
              value={dialog.startPoint} options={startPointOptions()}
              onChange={(v) => setDialog({ ...dialog, startPoint: v })}
              searchable searchPlaceholder={t("Branches_SearchPlaceholder")}
              tabs={[{ key: "branch", label: t("Common_Branch") }, { key: "tag", label: t("Branches_TagGroup") }]}
              activeTab={dialog.startPointTab}
              onTabChange={(key) => setDialog({
                ...dialog,
                startPointTab: key as "branch" | "tag",
                // 切到没有选中值的类型：清空选择（创建钮置灰），不静默代选
                startPoint: startPointType(dialog.startPoint) === key ? dialog.startPoint : "",
              })}
              placeholder={t("Branches_StartPointPlaceholder")}
            />
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={dialog.checkout} onChange={(e) => setDialog({ ...dialog, checkout: e.target.checked })} />
              {t("Branches_CheckoutAfter")}
            </label>
          </div>
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
      {dialog?.kind === "deleteRemote" && (
        <Modal
          title={t("Branches_DeleteRemoteTitle", dialog.name)}
          confirmText={t("Common_Delete")}
          danger
          onClose={() => setDialog(null)}
          onConfirm={() => {
            void run(async () => { await call("branches.deleteRemote", { name: dialog.name }); return t("Branches_DeletedRemote", dialog.name); });
            setDialog(null);
          }}
        >
          <div>{t("Branches_DeleteRemoteWarning", dialog.name)}</div>
        </Modal>
      )}
      {dialog?.kind === "reflog" && (
        <ReflogDialog
          refName={dialog.name}
          title={t("Reflog_Title", dialog.name)}
          currentBranch={state?.current ?? null}
          onChanged={() => void reload()}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "deleteTag" && (
        <Modal
          title={t("Branches_DeleteTagTitle", dialog.name)}
          confirmText={t("Common_Delete")}
          danger
          onClose={() => setDialog(null)}
          onConfirm={() => {
            void run(async () => { await call("tags.delete", { name: dialog.name }); return t("Branches_DeletedTag", dialog.name); });
            setDialog(null);
          }}
        >
          <div>{t("Branches_DeleteTagSafe", dialog.name)}</div>
        </Modal>
      )}
      {dialog?.kind === "merge" && (
        <Modal
          title={t("Branches_MergeTitlePlain")}
          confirmText={t("Common_Merge")}
          confirmDisabled={!dialog.source || !dialog.target}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            void run(async () => {
              await call("branches.merge", { name: dialog.source, target: dialog.target, noFf: dialog.noFf, message: dialog.message || null });
              return t("Branches_MergedInto", dialog.source.replace(/^refs\/(heads|remotes)\//, ""), dialog.target);
            });
            setDialog(null);
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ color: "var(--c-text3)", fontSize: 12 }}>{t("Branches_MergeSource")}</span>
            <Select className="full" style={{ width: "100%" }} value={dialog.source} options={mergeSourceOptions()}
              onChange={(v) => setDialog({ ...dialog, source: v })} />
            <span style={{ color: "var(--c-text3)", fontSize: 12 }}>{t("Branches_MergeTarget")}</span>
            <Select className="full" style={{ width: "100%" }} value={dialog.target} options={mergeTargetOptions()}
              onChange={(v) => setDialog({ ...dialog, target: v })} />
            {dialog.target !== state?.current && (
              <span style={{ color: "var(--c-text3)", fontSize: 12 }}>{t("Branches_MergeTargetHint")}</span>
            )}
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={dialog.noFf} onChange={(e) => setDialog({ ...dialog, noFf: e.target.checked })} />
              {t("Branches_NoFastForward")}
            </label>
          </div>
          <input className="input" style={{ width: "100%" }} placeholder={t("Branches_MergeMessagePlaceholder")}
            value={dialog.message} onChange={(e) => setDialog({ ...dialog, message: e.target.value })} />
        </Modal>
      )}
      {menuElement}
    </>
  );
}


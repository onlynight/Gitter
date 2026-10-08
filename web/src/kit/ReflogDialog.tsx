import { useEffect, useState } from "react";
import { call } from "../bridge/client";
import { t } from "../state/store";
import { Modal } from "./Dialogs";
import type { ReflogEntryDTO } from "../bridge/types";

/**
 * reflog 查看对话框（分支页/日志页共用，ui-branch-reflog）：
 * 列出某分支的 reflog（最新在前），每条可复制 SHA / 重置分支到此。
 * 重置语义按检出状态二分：目标 = 当前分支 → git reset --<mode>（软/混/硬）；
 * 目标非当前分支 → 仅移动分支指针（git branch -f），工作区与当前分支不受影响。
 * 底层数据：reflog.list + log.reset（带 branch 参数）。
 */
export function ReflogDialog(props: {
  /** 分支名（或 HEAD） */
  refName: string;
  title: string;
  /** 当前检出分支（判定重置语义用） */
  currentBranch?: string | null;
  /** 重置成功后的刷新回调 */
  onChanged?: () => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<ReflogEntryDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetEntry, setResetEntry] = useState<ReflogEntryDTO | null>(null);
  const [mode, setMode] = useState<"soft" | "mixed" | "hard">("mixed");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setEntries(null);
    setError(null);
    setResetEntry(null);
    call<ReflogEntryDTO[]>("reflog.list", { ref: props.refName, limit: 100 })
      .then((list) => { if (alive) setEntries(list); })
      .catch((e) => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.refName]);

  // 检出状态二分：当前分支 → 真 reset（动工作区）；非当前 → 只移指针
  const isCurrent = !props.currentBranch || props.refName === props.currentBranch;

  const doReset = async () => {
    if (!resetEntry) return;
    setBusy(true);
    try {
      await call("log.reset", { sha: resetEntry.sha, mode, branch: isCurrent ? undefined : props.refName });
      setError(null);
      setResetEntry(null);
      props.onChanged?.();
      // 重置后该分支 reflog 已变化，重拉
      const list = await call<ReflogEntryDTO[]>("reflog.list", { ref: props.refName, limit: 100 });
      setEntries(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string) => navigator.clipboard.writeText(text);

  return (
    <Modal
      title={props.title}
      confirmText={resetEntry ? t("Log_ResetConfirm") : t("Common_Close")}
      confirmDisabled={busy}
      width={620}
      onClose={() => { if (!busy) props.onClose(); }}
      onConfirm={() => { resetEntry ? void doReset() : props.onClose(); }}
    >
      {error && <div style={{ color: "var(--c-red)", fontSize: 12, marginBottom: 8, wordBreak: "break-all" }}>{error}</div>}

      {resetEntry ? (
        <div style={{ userSelect: "text" }}>
          <div style={{ marginBottom: 8 }}>
            {isCurrent
              ? t("Log_ResetBranchInfo", props.refName)
              : t("Log_ResetPointerHint")}
            {" → "}
            <span className="mono">{resetEntry.shortSha}</span>
            <div style={{ color: "var(--c-text3)", fontSize: 11.5, marginTop: 2 }}>
              {resetEntry.selector} · {resetEntry.subject}
            </div>
          </div>
          {(["soft", "mixed", "hard"] as const).map((m) => (
            <label key={m} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8, cursor: isCurrent ? "pointer" : "default", opacity: isCurrent ? 1 : 0.6 }}>
              <input type="radio" checked={mode === m} onChange={() => setMode(m)} style={{ marginTop: 2 }} />
              <span>
                <b style={{ color: m === "hard" ? "var(--c-red)" : undefined }}>{t(`Log_ResetMode_${m}`)}</b>
                <div style={{ fontSize: 11, color: "var(--c-text2)" }}>{t(`Log_ResetDesc_${m}`)}</div>
              </span>
            </label>
          ))}
          {isCurrent && mode === "hard" && (
            <div style={{ color: "var(--c-red)", fontSize: 11.5, marginTop: 8 }}>{t("Log_ResetHardWarning")}</div>
          )}
          {!isCurrent && (
            <div style={{ color: "var(--c-text3)", fontSize: 11.5, marginTop: 8 }}>
              {t("Log_ResetMode_soft")} —— {t("Log_ResetPointerHint")}
            </div>
          )}
          <button className="tool-btn" style={{ marginTop: 10 }} onClick={() => setResetEntry(null)}>{t("Common_Cancel")}</button>
        </div>
      ) : (
        <>
          <div style={{ color: "var(--c-text3)", fontSize: 11.5, marginBottom: 6 }}>{t("Reflog_Hint")}</div>
          <div style={{ maxHeight: 380, overflowY: "auto", border: "1px solid var(--c-border)", borderRadius: "var(--radius-md)" }}>
            {entries === null ? (
              <div style={{ padding: 16, color: "var(--c-text3)", fontSize: 12 }}>{t("Common_Loading")}</div>
            ) : entries.length === 0 ? (
              <div style={{ padding: 16, color: "var(--c-text3)", fontSize: 12 }}>{t("Reflog_Empty")}</div>
            ) : (
              entries.map((en, i) => (
                <div key={en.selector + i} className="list-row" style={{ minHeight: 28 }}>
                  <span className="mono" style={{ fontSize: 10.5 }}>{en.selector}</span>
                  <span className="trim" style={{ flex: 1, minWidth: 0, fontSize: 12 }} title={en.subject}>{en.subject}</span>
                  <span className="mono" style={{ fontSize: 10.5 }}>{new Date(en.timestamp * 1000).toLocaleString()}</span>
                  <button className="tool-btn" style={{ padding: "0 6px", minWidth: 22, fontSize: 11 }} title={t("Log_CopySha")}
                    onClick={() => copy(en.sha)}>⧉</button>
                  <button className="tool-btn" style={{ padding: "0 8px", fontSize: 11.5 }} title={t("Log_ResetToHere")}
                    onClick={() => { setMode("mixed"); setResetEntry(en); }}>{t("Log_ResetToHere").replace("…", "")}</button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

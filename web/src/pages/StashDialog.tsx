import { useEffect, useState } from "react";
import { pageSdk } from "../pageSdk";
import { Modal } from "../kit";
import { TlIcon } from "./taskIcons";
import type { StashEntryDTO, StashFileDTO } from "../bridge/types";

// R1 宿主面收敛：本组件随页面包构建，t 必须走 pageSdk（宿主活 store）——
// 若 import "../state/store" 会被打进页面包成为私有 store 副本，永远等不到 i18n 加载，t() 原样吐 key
const { call, t } = pageSdk;

/**
 * stash 管理对话框（stash-mockup.html：变更页工具栏收件箱图标钮承载）：
 * 顶部 = 消息输入 + 暂存修改（git stash push -u，工作区干净时禁用）；
 * 列表 = stash@{n} 最新在前，行操作 应用并删除（pop 语义）/ 仅应用（apply）/ 删除（drop）；
 * 行首 chevron 展开该条涉及文件（git stash show --include-untracked --name-status）。
 * 冲突语义按 git：apply 遇冲突条目保留，冲突文件落变更页 conflicts 组——底部固定说明。
 * 不提供「清空全部」（safety 层把 stash clear 列为危险拦截，UI 同样不做入口）。
 */

function relativeTime(unix: number): string {
  const diff = Date.now() / 1000 - unix;
  if (diff < 60) return t("Log_JustNow");
  if (diff < 3600) return t("Log_MinutesAgo", Math.floor(diff / 60));
  if (diff < 86400) return t("Log_HoursAgo", Math.floor(diff / 3600));
  if (diff < 86400 * 30) return t("Log_DaysAgo", Math.floor(diff / 86400));
  return new Date(unix * 1000).toLocaleDateString();
}

export function StashDialog(props: {
  /** 工作区是否有未提交变更（决定「暂存修改」是否可用） */
  hasChanges: boolean;
  /** 任一改仓动作后的刷新回调（页面 notifyRepoChanged） */
  onChanged?: () => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<StashEntryDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [files, setFiles] = useState<StashFileDTO[]>([]);

  const reload = async () => {
    try {
      setEntries(await call<StashEntryDTO[]>("stash.list", {}));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (fn: () => Promise<void>, doneText: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await fn();
      setMessage("");
      setExpanded(null);
      setFiles([]);
      props.onChanged?.();
      await reload();
      setDone(doneText);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleExpand = async (index: number) => {
    if (expanded === index) { setExpanded(null); return; }
    setExpanded(index);
    try {
      setFiles(await call<StashFileDTO[]>("stash.show", { index }));
    } catch (e) {
      setFiles([]);
      setError((e as Error).message);
    }
  };

  return (
    <Modal
      title={t("Changes_StashManage")}
      width={620}
      confirmText={t("Common_Close")}
      confirmDisabled={busy}
      onClose={() => { if (!busy) props.onClose(); }}
      onConfirm={() => props.onClose()}
    >
      {error && <div style={{ color: "var(--c-red)", fontSize: 12, marginBottom: 6, wordBreak: "break-all" }}>{error}</div>}
      {done && <div style={{ color: "var(--c-green)", fontSize: 12, marginBottom: 6 }}>{done}</div>}
      <div style={{ color: "var(--c-text3)", fontSize: 11.5, marginBottom: 6 }}>{t("Changes_StashHint")}</div>

      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder={t("Changes_StashMessagePlaceholder")}
          spellCheck={false}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && props.hasChanges) void act(async () => { await call("stash.push", { message: message.trim() || null }); }, t("Changes_StashSaved")); }}
        />
        <button className="tool-btn primary" disabled={busy || !props.hasChanges}
          onClick={() => void act(async () => { await call("stash.push", { message: message.trim() || null }); }, t("Changes_StashSaved"))}>
          <TlIcon name="archive" size={12} />
          {t("Changes_StashSave")}
        </button>
      </div>

      <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid var(--c-border)", borderRadius: "var(--radius-md)" }}>
        {entries === null ? (
          <div style={{ padding: 16, color: "var(--c-text3)", fontSize: 12 }}>{t("Common_Loading")}</div>
        ) : entries.length === 0 ? (
          <div style={{ padding: 16, color: "var(--c-text3)", fontSize: 12 }}>{t("Changes_StashEmpty")}</div>
        ) : (
          entries.map((en) => (
            <div key={en.selector} style={{ borderBottom: "1px solid var(--c-border)" }}>
              <div className="list-row" style={{ minHeight: 30 }}>
                <button className="icon-btn" data-tip={t("Common_Expand")} disabled={busy}
                  onClick={() => void toggleExpand(en.index)}
                  style={{ width: 18, height: 18 }}>
                  <TlIcon name="chevron-down" size={10} className={expanded === en.index ? undefined : "cv-closed"} />
                </button>
                <span className="mono" style={{ fontSize: 10.5, flex: "none", width: 58 }}>{en.selector}</span>
                <span className="trim" style={{ flex: 1, minWidth: 0, fontSize: 12 }} title={en.subject}>{en.message}</span>
                <span className="trim" style={{ flex: "none", color: "var(--c-text3)", fontSize: 11, maxWidth: 140 }}>
                  {[en.branch, relativeTime(en.timestamp)].filter(Boolean).join(" · ")}
                </span>
                <button className="tool-btn" style={{ padding: "0 8px", fontSize: 11.5 }} title={t("Changes_StashPopTip")}
                  disabled={busy}
                  onClick={() => void act(async () => { await call("stash.apply", { index: en.index, drop: true }); }, t("Changes_StashAppliedPop", en.selector))}>
                  {t("Changes_StashPop")}
                </button>
                <button className="tool-btn" style={{ padding: "0 8px", fontSize: 11.5 }} title={t("Changes_StashApplyTip")}
                  disabled={busy}
                  onClick={() => void act(async () => { await call("stash.apply", { index: en.index }); }, t("Changes_StashApplied", en.selector))}>
                  {t("Changes_StashApply")}
                </button>
                <button className="tool-btn danger" style={{ padding: "0 8px", fontSize: 11.5 }} title={t("Changes_StashDrop")}
                  disabled={busy}
                  onClick={() => void act(async () => { await call("stash.drop", { index: en.index }); }, t("Changes_StashDropped", en.selector))}>
                  {t("Changes_StashDrop")}
                </button>
              </div>
              {expanded === en.index && (
                <div style={{ margin: "0 10px 6px 44px", padding: "4px 10px", borderLeft: "2px solid var(--c-border-strong)" }}>
                  {files.length === 0 ? (
                    <div style={{ color: "var(--c-text3)", fontSize: 11, padding: "2px 0" }}>{t("Common_Loading")}</div>
                  ) : files.map((f) => (
                    <div key={f.path} style={{ display: "flex", gap: 6, alignItems: "center", padding: "1.5px 0" }}>
                      <span className={"status-letter " + (f.code === "?" ? "st-U" : "st-" + f.code)} style={{ fontSize: 9, width: 12, height: 12 }}>{f.code === "?" ? "?" : f.code}</span>
                      <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--c-text2)", wordBreak: "break-all", userSelect: "text" }}>{f.path}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div style={{ color: "var(--c-text3)", fontSize: 11, marginTop: 8 }}>{t("Changes_StashConflictHint")}</div>
    </Modal>
  );
}

import { useEffect, useState } from "react";
import { onEvent } from "../bridge/client";

export interface SyncProgressState {
  text: string;
  percent: number | null;
}

/**
 * 同步进度条（push/pull/fetch 的 --progress 行）：
 * 有百分比走确定条，无则不定态动画；事件由主进程 sync.progress 推送（已节流）。
 */
export function useSyncProgress(): [SyncProgressState | null, () => void] {
  const [state, setState] = useState<SyncProgressState | null>(null);
  useEffect(() => onEvent("sync.progress", (p: SyncProgressState) => setState(p)), []);
  const clear = () => setState(null);
  return [state, clear];
}

export function SyncBar({ progress }: { progress: SyncProgressState | null }) {
  if (!progress) return null;
  const known = progress.percent !== null;
  return (
    <div className="syncbar">
      <span className="syncbar-text" title={progress.text}>{progress.text}</span>
      <span className={"bar" + (known ? "" : " indeterminate")}>
        <i style={known ? { width: `${progress.percent}%` } : undefined} />
      </span>
      {known && <span className="syncbar-pct">{progress.percent}%</span>}
    </div>
  );
}

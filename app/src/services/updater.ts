import { app } from "electron";
import { autoUpdater } from "electron-updater";
import * as semver from "semver";

/**
 * 自动更新（M3.1 升级版，harness-mainline-roadmap.md——2026-10-12 用户裁决：做完整自动更新）：
 * electron-updater（electron-builder 生态，NSIS 通道）+ 可配更新源。
 * - 更新源 settings.updateCheckUrl：github.com/<owner>/<repo> → GitHub Releases provider；
 *   其余 http(s) → generic provider（目录内放 latest.yml + 安装包；粘贴 latest.yml 全路径自动取目录）。
 * - 流程恒为「人触发检查 → 提示 → 下载（进度广播）→ 重启安装」；不做后台静默下载。
 *   已下载的更新在应用退出时自动安装（autoInstallOnAppQuit，UI 提示）。
 * - 无签名裁决：Windows 通道 electron-updater 以 latest.yml 的 SHA512 校验包完整性，不强制 Authenticode。
 * - dev（未打包）回退：直接拉取更新源 URL 的 JSON（GitHub API releases/latest 形状）做 semver 比较，仅检查不下载。
 */

export type UpdatePhase = "idle" | "checking" | "available" | "none" | "downloading" | "downloaded" | "error";

export interface UpdateStateDTO {
  phase: UpdatePhase;
  current: string;
  latest: string | null;
  /** 下载进度 0–100（仅 downloading） */
  progress: number | null;
  error: string | null;
  feedConfigured: boolean;
  /** true = dev 回退检查（不可下载安装） */
  devFallback: boolean;
  /** 发布页 URL（GitHub provider 提供；generic 取源目录） */
  infoUrl: string | null;
}

type Broadcast = (method: string, params: unknown) => void;

let broadcast: Broadcast | null = null;
let state: UpdateStateDTO = {
  phase: "idle", current: "0.0.0", latest: null, progress: null, error: null,
  feedConfigured: false, devFallback: false, infoUrl: null,
};
let wired = false;

/** 更新源解析：github.com/owner/repo → GitHub provider；其余 http(s) → generic（latest.yml 全路径取目录）。 */
export function resolveFeed(url: string):
  | { provider: "generic"; url: string }
  | { provider: "github"; owner: string; repo: string }
  | null {
  const u = url.trim();
  if (!u) return null;
  const gh = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s?#]+)/i.exec(u);
  if (gh) return { provider: "github", owner: gh[1], repo: gh[2].replace(/\.git$/i, "") };
  if (!/^https?:\/\//i.test(u)) return null;
  let base = u.replace(/\/+$/, "");
  base = base.replace(/\/latest\.yml$/i, "");
  return { provider: "generic", url: base };
}

function pub(next: Partial<UpdateStateDTO>): UpdateStateDTO {
  state = { ...state, ...next };
  broadcast?.("app.update.event", state);
  return state;
}

export function updateState(): UpdateStateDTO {
  return state;
}

/** 初始化（main 启动时一次；headless 模式不调用）。feedUrlGetter 每次检查时取 settings 最新值。 */
export function initUpdater(b: Broadcast, feedUrlGetter: () => string | null | undefined): void {
  broadcast = b;
  state.current = app.getVersion();
  state.devFallback = !app.isPackaged;
  void feedUrlGetter;

  if (wired || !app.isPackaged) return;
  wired = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on("update-available", (info) => {
    pub({ phase: "available", latest: String((info as { version?: string }).version ?? "") || null, error: null });
  });
  autoUpdater.on("update-not-available", () => {
    pub({ phase: "none", latest: null, error: null });
  });
  autoUpdater.on("download-progress", (p) => {
    pub({ phase: "downloading", progress: Math.min(100, Math.max(0, Number((p as { percent?: number }).percent ?? 0))) });
  });
  autoUpdater.on("update-downloaded", (info) => {
    pub({ phase: "downloaded", progress: 100, latest: String((info as { version?: string }).version ?? state.latest ?? "") || null });
  });
  autoUpdater.on("error", (e) => {
    pub({ phase: "error", error: (e as Error).message?.slice(0, 300) ?? "更新出错" });
  });
}

/** 检查更新：打包态走 electron-updater（可用后可下载）；dev 态回退 HTTP semver 比较（仅检查）。 */
export async function checkForUpdates(feedUrl: string | null | undefined): Promise<UpdateStateDTO> {
  const current = app.getVersion();
  state.current = current;
  state.devFallback = !app.isPackaged;
  const feed = resolveFeed(feedUrl ?? "");
  state.feedConfigured = !!feed;
  if (!feed) {
    return pub({ phase: "error", error: "未配置更新源（设置 → 关于：GitHub 仓库或 latest.yml 所在目录 URL）", latest: null, progress: null });
  }
  pub({ phase: "checking", error: null });
  if (!app.isPackaged) {
    // dev 回退：拉 JSON（GitHub API releases/latest 或 {tag_name|version}）做 semver 比较
    const url = feedUrl!.trim();
    try {
      const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { tag_name?: string; html_url?: string; version?: string };
      const latest = (j.tag_name ?? j.version ?? "").replace(/^v/i, "") || null;
      const available = !!latest && !!semver.valid(latest) && semver.gt(latest, current);
      return pub({
        phase: available ? "available" : "none",
        latest: available ? latest : null,
        infoUrl: j.html_url ?? null,
        error: null,
      });
    } catch (e) {
      return pub({ phase: "error", error: `检查失败：${(e as Error).message}` });
    }
  }
  try {
    if (feed.provider === "github") {
      autoUpdater.setFeedURL({ provider: "github", owner: feed.owner, repo: feed.repo });
    } else {
      autoUpdater.setFeedURL({ provider: "generic", url: feed.url });
    }
    state.infoUrl = feed.provider === "github" ? `https://github.com/${feed.owner}/${feed.repo}/releases/latest` : feed.url;
    await autoUpdater.checkForUpdates();
    // 终态由事件回调 pub（available/none/error）
    return state;
  } catch (e) {
    return pub({ phase: "error", error: `检查失败：${(e as Error).message}` });
  }
}

/** 下载更新（仅打包态 available 后可用）。 */
export async function downloadUpdate(): Promise<UpdateStateDTO> {
  if (!app.isPackaged) return pub({ phase: "error", error: "dev 模式不支持下载（请用打包版）" });
  if (state.phase !== "available" && state.phase !== "error") return state;
  try {
    await autoUpdater.downloadUpdate();
    return state; // 终态由 update-downloaded / error 事件 pub
  } catch (e) {
    return pub({ phase: "error", error: `下载失败：${(e as Error).message}` });
  }
}

/** 重启并安装（NSIS assisted：跑安装器后自动拉起应用）。 */
export function installUpdate(): void {
  if (!app.isPackaged || state.phase !== "downloaded") return;
  autoUpdater.quitAndInstall(false, true);
}

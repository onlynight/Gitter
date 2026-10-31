import { tryGit } from "./gitexec";
import { runExclusive } from "./ioQueue";

/**
 * Git 状态后台调度器（files 页性能优化——超大项目 git 不再把 CPU 占满）：
 *
 * 背景：原 repo.tree 在每次树刷新时同步阻塞跑 `git status --porcelain` +
 * `git diff --numstat`×2 + `git ls-files -o -i`，超大项目下 git 遍历全工作区，
 * 且 fs.changed 触发的刷新会反复触发多进程并发 git，CPU 占满、树卡死。
 *
 * 新架构：文件树（treex）只做磁盘扫描（readdir，磁盘即真相），git 状态
 * 彻底从 repo.tree 请求路径剥离，改由本服务在后台单线程串行计算并通过
 * `git.status.changed` 事件推送。前端树先渲染，状态增量到达后原地更新。
 *
 * 设计要点：
 * - 单线程串行 pump：内部 promise 链，同一时刻只跑一个 git 状态计算；
 *   `git status` 与 `git ls-files -o -i` 在同一任务内串行（非 Promise.all），
 *   保证任意时刻主进程最多 spawn 一个 git 进程。
 * - 节流合并：markDirty 只标脏，已有定时器则不动；throttleMs 窗口内
 *   多次标脏合并为一次重算（默认 1500ms）。
 * - 只算被订阅仓库：subscribe 时加入 active 并立即排一次；unsubscribe 时
 *   无订阅者则移除。无订阅者不跑 git，避免后台空转。
 * - 过期丢弃：计算前记录版本号，完成后若期间有新标脏则推送旧快照后
 *   继续排下一轮（保证前端不长期缺状态）。
 * - 推送：计算完成经 onEvent 发 `git.status.changed`，前端按 version 单调判断。
 */

/** 文件树用的扁平 git 状态快照（与 shared/types.ts GitStatusSnapshotDTO 同步）。 */
export interface GitStatusSnapshot {
  workDir: string;
  /** 单调递增版本号：前端据此丢弃乱序/过期推送 */
  version: number;
  /** 路径 → 状态码（M/A/D/R/U/?），扁平；! 在 ignored 里单独列 */
  statusMap: Record<string, string>;
  /** 被 .gitignore 忽略的路径（前端置灰标注 !） */
  ignored: string[];
  /** 当前分支名；detached HEAD 时为 "HEAD" */
  branch: string | null;
  /** 领先/落后 upstream 的提交数；无 upstream 为 null */
  ahead: number | null;
  behind: number | null;
}

/** 被 .gitignore 忽略的树条目状态码（前端置灰）。 */
const IGNORED = "!";

/** 冲突代码集（与 gitstatus.ts CONFLICT_CODES 语义对齐）。 */
const CONFLICT_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

/**
 * porcelain 单字母状态码映射（与 treex.statusLetter 语义对齐）：
 * conflict → U；untracked → ?；其余取 code[0]（staged 取 index 位）。
 */
function statusLetter(x: string, y: string): string {
  if (CONFLICT_CODES.has(`${x}${y}`) || x === "U" || y === "U") return "U";
  if (x === "?" && y === "?") return "?";
  const code = x !== " " && x !== "?" ? x : y;
  return code?.[0] ?? "M";
}

export class GitStatusService {
  private chain: Promise<void> = Promise.resolve();
  private throttleTimer: NodeJS.Timeout | null = null;
  /** workDir → 版本号（单调递增） */
  private version = new Map<string, number>();
  /** workDir → 当前快照（缓存，subscribe 初始返回） */
  private cache = new Map<string, GitStatusSnapshot>();
  /** workDir → 订阅回调集 */
  private subs = new Map<string, Set<(snap: GitStatusSnapshot) => void>>();
  /** 脏仓库集合（待重算） */
  private dirty = new Set<string>();

  constructor(
    private readonly onEvent: (method: string, params: unknown) => void,
    private readonly throttleMs = 1500,
  ) {}

  /** 订阅某仓库状态；返回初始快照（可能为 null = 尚无缓存，等首次推送）。 */
  subscribe(workDir: string, cb: (snap: GitStatusSnapshot) => void): GitStatusSnapshot | null {
    let set = this.subs.get(workDir);
    if (!set) {
      set = new Set();
      this.subs.set(workDir, set);
    }
    set.add(cb);
    // 订阅后走节流延迟重算（不立即）：首次进入 files 页先让首屏树渲染，
    // git status 延迟到 1.5s 节流窗口后开始，避免与首屏 repo.tree 抢磁盘 I/O。
    // 有缓存时前端已立即拿到快照（树状态不空白）；无缓存则等延迟后的首次推送。
    this.markDirty(workDir, false);
    return this.cache.get(workDir) ?? null;
  }

  /** 取消订阅；无订阅者时移除仓库并清缓存（不再空转）。 */
  unsubscribe(workDir: string, cb: (snap: GitStatusSnapshot) => void): void {
    const set = this.subs.get(workDir);
    if (!set) return;
    set.delete(cb);
    if (set.size === 0) {
      this.subs.delete(workDir);
      this.cache.delete(workDir);
      this.version.delete(workDir);
      this.dirty.delete(workDir);
    }
  }

  /** 外部事件（fs.changed / git 操作）→ 标脏重算。immediate=true 跳过节流立即排。 */
  markDirty(workDir: string, immediate = false): void {
    if (!this.subs.has(workDir)) return; // 无订阅者不空转
    this.dirty.add(workDir);
    if (immediate) {
      this.schedule(0);
    } else if (this.throttleTimer === null) {
      this.schedule(this.throttleMs);
    }
    // 已有定时器：窗口内合并，不再排
  }

  /** 仓库关闭：清缓存与订阅。 */
  close(workDir: string): void {
    this.subs.delete(workDir);
    this.cache.delete(workDir);
    this.version.delete(workDir);
    this.dirty.delete(workDir);
  }

  private schedule(delay: number): void {
    if (this.throttleTimer) clearTimeout(this.throttleTimer);
    this.throttleTimer = setTimeout(() => {
      this.throttleTimer = null;
      void this.pump();
    }, delay);
  }

  /** 单线程串行 pump：同一时刻只跑一个 git 状态计算。 */
  private pump(): Promise<void> {
    this.chain = this.chain.then(() => this.runOne());
    return this.chain;
  }

  /** 取一个脏仓库计算并推送；空队列直接返回。 */
  private async runOne(): Promise<void> {
    if (this.dirty.size === 0) return;
    const workDir = this.dirty.values().next().value as string;
    this.dirty.delete(workDir);
    try {
      // git 计算经 ioQueue 串行（与树全量扫描共享队列，不并发抢磁盘）
      const snap = await runExclusive(() => this.compute(workDir));
      this.cache.set(workDir, snap);
      this.version.set(workDir, snap.version);
      const cbs = this.subs.get(workDir);
      if (cbs) {
        for (const cb of cbs) cb(snap);
        // 事件推送：前端订阅 git.status.changed
        this.onEvent("git.status.changed", snap);
      }
    } catch {
      // 计算失败（非 git 目录/权限）：保留旧缓存，不推送；不中断队列
    }
    // 计算期间又有新标脏：排下一轮（保证前端不长期缺状态）
    if (this.dirty.size > 0) this.schedule(0);
  }

  /** 实际计算：git status porcelain + git ls-files -o -i（串行，单进程）。 */
  private async compute(workDir: string): Promise<GitStatusSnapshot> {
    const version = (this.version.get(workDir) ?? 0) + 1;

    // 1) git status --porcelain=v1 -z --untracked-files=normal（无 diff numstat / headInfo）
    const statusMap: Record<string, string> = {};
    const r = await tryGit(workDir, [
      "status", "--porcelain=v1", "-z", "--untracked-files=normal",
    ]);
    if (r.code === 0) {
      const parts = r.stdout.split("\0");
      let i = 0;
      while (i < parts.length) {
        const entry = parts[i];
        i++;
        if (!entry) continue;
        const x = entry[0];
        const y = entry[1];
        let p = entry.slice(3);
        // porcelain v1 -z：R/C 记录为 "XY new\0old\0"，追加消费 origPath
        if (x === "R" || x === "C" || y === "R" || y === "C") i++;
        if (!p) continue;
        // untracked 目录是折叠形式 "dir/"：剥尾斜杠让目录条目直接命中
        if (p.endsWith("/")) p = p.slice(0, -1);
        statusMap[p] = statusLetter(x, y);
      }
    }

    // 2) 被 .gitignore 忽略的未跟踪文件（前端置灰 !）；串行，不并发
    let ignored: string[] = [];
    const ri = await tryGit(workDir, ["ls-files", "-o", "-i", "--exclude-standard"]);
    if (ri.code === 0) {
      ignored = ri.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }

    // 3) 分支 + 领先/落后（轻量；失败静默 null）
    let branch: string | null = null;
    let ahead: number | null = null;
    let behind: number | null = null;
    const rb = await tryGit(workDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (rb.code === 0) {
      branch = rb.stdout.trim() || null;
      const ab = await tryGit(workDir, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
      if (ab.code === 0) {
        const [a, b] = ab.stdout.trim().split(/\s+/).map(Number);
        ahead = a || 0;
        behind = b || 0;
      }
    }

    return { workDir, version, statusMap, ignored, branch, ahead, behind };
  }
}

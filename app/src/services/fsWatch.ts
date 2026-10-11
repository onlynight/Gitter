import * as fs from "fs";

/**
 * 仓库工作区监听（files 页外部变更刷新，external-change-watch）：
 * fs.watch 递归监听仓库根，文件事件防抖合并为一个不带路径的通知——
 * 渲染层收到 fs.changed 后自行决定：刷树 + 校验打开标签的 mtime。
 * Windows/macOS 原生支持 recursive；监听不可用（权限/网络盘）时静默降级为手动刷新。
 */
export class FsWatchService {
  private watcher: fs.FSWatcher | null = null;
  private dir: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  /** 目录变化即重启；同目录重复 start 幂等。 */
  start(dir: string, onFire: () => void): void {
    if (this.dir === dir) return;
    this.stop();
    try {
      this.watcher = fs.watch(dir, { recursive: true }, () => this.schedule(onFire));
      this.dir = dir;
    } catch {
      // 监听不可用：保持空实现，树刷新退回手动
    }
  }

  /** git 操作/构建工具一次落盘几十个事件，600ms 合并为一次通知 */
  private schedule(onFire: () => void): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      onFire();
    }, 600);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.watcher?.close();
    this.watcher = null;
    this.dir = null;
  }
}

/**
 * 重磁盘 IO 串行队列（首次打开 files 页性能优化）：
 * 超大项目首次打开时，git status 全量遍历与文件树全量扫描并发抢磁盘 I/O，
 * 两者互相拖慢（首屏 10s+）。本队列让所有「重磁盘操作」串行执行——
 * 同一时刻只有一个重 IO 任务在跑，消除磁盘竞争。
 *
 * 注意：浅层首屏扫描（repo.tree shallow=true，毫秒级）不排队、优先执行，
 * 保证目录立即显示；后台全量补全与 git status 都经本队列串行。
 */

let chain: Promise<void> = Promise.resolve();

/** 串行执行 fn：前一个完成（含失败）后才启动下一个。 */
export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn); // 前一个失败不阻塞后一个
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

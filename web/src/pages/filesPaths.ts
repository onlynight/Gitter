/**
 * 文件页路径工具：仓库相对路径 ↔ 展示/外发用的原生绝对路径。
 *
 * 树内的 rel 一律是 POSIX 斜杠（git ls-files 契约）；workDir 来自主进程
 * path 解析，分隔符是本机原生风格（Windows 反斜杠 / POSIX 斜杠）。
 * 拼接必须跟随 workDir 的风格——「复制路径」落到剪贴板的是给资源管理器/
 * 终端用的字符串，`D:\Code\Gitter/src/a.ts` 这种混合斜杠是错的。
 */

/** 去掉末尾分隔符并判断 workDir 的原生分隔符风格（含反斜杠 = Windows 系）。 */
export function nativeSepOf(workDir: string): "\\" | "/" {
  return workDir.replace(/[\\/]+$/, "").includes("\\") ? "\\" : "/";
}

/** 仓库相对路径 → 原生分隔符绝对路径（外发 shell.openPath/reveal/剪贴板用）。 */
export function absPathOf(workDir: string, rel: string): string {
  const base = workDir.replace(/[\\/]+$/, "");
  const sep = nativeSepOf(workDir);
  const tail = rel.replace(/\\/g, "/").replace(/^[/\\]+/, "");
  return base + sep + tail.split("/").join(sep);
}

/**
 * 绝对路径 → 仓库相对路径（外部文件拖入打开）；仓库外返回 null。
 * 前缀比较大小写不敏感（Windows 盘符/目录大小写不稳），返回段保留原样。
 */
export function relOfWork(workDir: string, abs: string): string | null {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const base = norm(workDir);
  const a = norm(abs);
  if (!a.toLowerCase().startsWith(base.toLowerCase() + "/")) return null;
  return a.slice(base.length + 1);
}

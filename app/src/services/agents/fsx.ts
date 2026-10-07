import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";

/**
 * 工具面纯函数（agent-harness-v4.md F2/F3）：
 * 路径锁（含 symlink realpath 校验）、glob→regex、相似位置提示、unified diff 统计。
 * 全部可单测，无 IO 副作用（除 resolveReal）。
 */

/** resolve + realpath 双重校验：路径与其各级 symlink 都不得越出 worktree。 */
export async function resolveSafe(worktreePath: string, p: string): Promise<string> {
  const abs = path.resolve(worktreePath, p);
  const rel = path.relative(worktreePath, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`路径越出 worktree 边界：${p}`);
  }
  try {
    const real = await fsp.realpath(abs);
    const realWt = await fsp.realpath(worktreePath);
    const relReal = path.relative(realWt, real);
    if (relReal.startsWith("..") || path.isAbsolute(relReal)) {
      throw new Error(`路径经符号链接越出 worktree 边界：${p}`);
    }
    return real;
  } catch (e) {
    if ((e as Error).message.includes("worktree")) throw e;
    return abs; // 不存在（写入场景）：path.resolve 校验已过
  }
}

/** glob → regex：** 跨目录，* 单段，? 单字符。 */
export function globToRegex(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // ** ：吞并后续相邻的 /
        let j = i + 2;
        while (glob[j] === "*") j++;
        if (glob[j] === "/") j++;
        re += "(?:.*)";
        i = j - 1;
      } else {
        re += "[^/\\\\]*";
      }
    } else if (c === "?") {
      re += "[^/\\\\]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$", "i");
}

/** 基础名匹配：pattern 无 / 时对 basename 匹配（glob 惯例）。 */
export function globMatch(glob: string, relPath: string): boolean {
  const g = glob.replace(/\\/g, "/");
  if (!g.includes("/")) {
    const base = relPath.replace(/\\/g, "/").split("/").pop() ?? "";
    return globToRegex(g).test(base);
  }
  return globToRegex(g).test(relPath.replace(/\\/g, "/"));
}

/** 二进制嗅探：首 8KB 含 \0。 */
export function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp"]);

export function isImageExt(p: string): boolean {
  return IMAGE_EXTS.has(path.extname(p).toLowerCase());
}

/**
 * 相似位置提示（F3.1）：oldString 首行与文件 3 行滑窗的最长公共子串相似度 ≥ 阈值的首个行号。
 * 供 patch 0 命中时给模型自纠锚点。
 */
export function nearestSimilarLine(text: string, needle: string, threshold = 0.6): number | null {
  const lines = text.split(/\r?\n/);
  const key = needle.replace(/\r?\n/g, " ").trim().slice(0, 80);
  if (!key) return null;
  const window = lines.slice(0, 3).map((l) => l.trim()).join(" ");
  for (let i = 0; i + 3 <= lines.length; i++) {
    const seg = (i === 0 ? window : lines.slice(i, i + 3).map((l) => l.trim()).join(" "));
    if (!seg) continue;
    if (similarity(seg, key) >= threshold) return i + 1;
  }
  // 兜底：单行包含判定
  for (let i = 0; i < lines.length; i++) {
    if (key.length >= 8 && lines[i].includes(key.slice(0, Math.min(40, key.length)))) return i + 1;
  }
  return null;
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  if (Math.max(m, n) > 400) return a.includes(b.slice(0, 40)) || b.includes(a.slice(0, 40)) ? 0.7 : 0;
  // LCS 滚动数组
  let prev = new Uint16Array(n + 1);
  let cur = new Uint16Array(n + 1);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n] / Math.max(m, n);
}

/** unified diff 行数统计（新增行按 + 开头，删除按 -；跳过头尾元信息）。 */
export function diffStat(patch: string): { added: number; deleted: number } {
  let added = 0, deleted = 0;
  let inHunk = false;
  for (const raw of patch.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("@@")) { inHunk = true; continue; }
    if (!inHunk) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) deleted++;
  }
  return { added, deleted };
}

/** 行级 LCS diff 统计（写工具回执 +N −M；大文件退化为行数差）。 */
export function lineDiffOf(oldText: string, newText: string): { added: number; deleted: number } {
  const a = oldText.split(/\r?\n/);
  const b = newText.split(/\r?\n/);
  if (a.length > 5000 || b.length > 5000) {
    const d = b.length - a.length;
    return d >= 0 ? { added: d, deleted: 0 } : { added: 0, deleted: -d };
  }
  const m = a.length, n = b.length;
  // LCS DP（滚动行）
  const dp: Uint32Array[] = [];
  for (let i = 0; i <= m; i++) dp.push(new Uint32Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const common = dp[m][n];
  return { added: n - common, deleted: m - common };
}

/** 从 unified diff 抽 hunk 新起始行号（多命中提示用）。 */
export function diffNewLines(patch: string): number[] {
  const out: number[] = [];
  let inHunk = false;
  let ln = 0;
  for (const raw of patch.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("@@")) {
      inHunk = true;
      ln = parseInt(/\+(\d+)/.exec(line)?.[1] ?? "1", 10);
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("+")) { out.push(ln); ln++; }
    else if (line.startsWith("-")) { /* 删除行不占新行号 */ }
    else if (line.length > 0) ln++;
  }
  return out;
}

/** 文件存在性与 mtime 快照（readLog 登记）。 */
export async function statSafe(abs: string): Promise<{ mtimeMs: number; size: number } | null> {
  try {
    const st = await fsp.stat(abs);
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

export async function readFileText(abs: string, cap = 2 * 1024 * 1024): Promise<string> {
  const buf = await fsp.readFile(abs);
  return buf.length > cap ? buf.subarray(0, cap).toString("utf8") : buf.toString("utf8");
}

export { fs, fsp, path };

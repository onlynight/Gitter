/**
 * DiffView 的 Monarch 语法高亮装配（渲染层）：
 * 分词由 gitui.lib.monaco 库包的 monacoSyntax.tokenizeLines 承担（与编辑器同一
 * monaco 实例、同一 Monarch 词法器），本模块只做 token type → 颜色的映射与 SyntaxRun
 * 转换——与 filesMonaco.buildTheme 同一语义：theme.syntax 键是 monarch token type 的
 * 点段前缀（如 "type" 命中 "type.identifier"、"keyword" 命中 "keyword.flow"），最长
 * 命中赢；未命中 = 纯文本。runs 只存 style 键不存色值，renderCode 渲染时查表——切主题
 * 免重分词，随 theme.syntax 即时换色。
 *
 * TextMate 链（主进程 highlight.file）保留未删但 DiffView 不再调用（迁移裁决：
 * TextMate 分词与编辑器 Monarch 观感不一致——type/keyword 细分、嵌入式语言、跨行状态
 * 都存在差异；Monarch 路径与文件页编辑器完全同源）。
 */

/** DiffView 渲染用的语法 run：style = theme.syntax 键（"plain" = 无命中），渲染层查表取色 */
export interface SyntaxRun {
  start: number;
  end: number;
  style: string;
  /** TextMate 路径遗留字段：Monarch 路径不产色值（保留类型兼容 TaskChangesPanel 直调） */
  color?: string;
}

/** monacoSyntax.tokenizeLines 的单行产出（行内偏移 [start,end)，type = monarch token type） */
export interface MonarchTokenRun {
  start: number;
  end: number;
  type: string;
}

interface MonacoSyntaxLib {
  tokenizeLines(text: string, languageId: string): Promise<MonarchTokenRun[][]>;
}

/** 库包分词面（页装载器按 manifest dependencies 先注入 gitui.lib.monaco；未注入返回 null，
 *  调用方降级纯文本——不抛错不重试）。 */
export function monacoSyntax(): MonacoSyntaxLib | null {
  const w = window as unknown as { GITTER_LIBS?: Record<string, unknown> };
  return (w.GITTER_LIBS?.monacoSyntax as MonacoSyntaxLib | undefined) ?? null;
}

/** theme.syntax 键前缀匹配（点段边界；"type" 不命中 "typex"，命中 "type.x"）。最长键赢。 */
export function matchSyntaxKey(type: string, keys: string[]): string | null {
  let best: string | null = null;
  for (const k of keys) {
    if (!k || (type !== k && !type.startsWith(k + "."))) continue;
    if (best === null || k.length > best.length) best = k;
  }
  return best;
}

/** 单行 monarch token → SyntaxRun[]：命中键作 style，未命中并入 "plain"，相邻同 style 合并。 */
export function toSyntaxRuns(tokens: MonarchTokenRun[] | undefined, keys: string[]): SyntaxRun[] {
  const out: SyntaxRun[] = [];
  if (!tokens) return out;
  for (const t of tokens) {
    const style = matchSyntaxKey(t.type, keys) ?? "plain";
    const last = out[out.length - 1];
    if (last && last.style === style && last.end === t.start) {
      last.end = t.end;
    } else {
      out.push({ start: t.start, end: t.end, style });
    }
  }
  return out;
}

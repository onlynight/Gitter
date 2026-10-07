import * as fs from "fs";
import * as path from "path";

// 声明式语法高亮引擎（C# P4a/P4b 声明式引擎的 TS 移植）：
// 数据 = highlighters.json（与旧栈 GitUI.syntax.builtin 包同一份文件）：
//   { id, language, extensions[], rules[{ style, pattern | keywords[] | blockStart/blockEnd }] }
// 算法：单遍状态机——块规则（跨行字面量定界）优先于行内规则；行内规则按声明顺序
// 锚定匹配（第一条命中即赢），keywords 仅在词首命中。v1 不支持嵌套/子模式。

interface HighlightRule {
  style: string;
  pattern?: string;
  keywords?: string[];
  blockStart?: string;
  blockEnd?: string;
}

interface Highlighter {
  id: string;
  language: string;
  extensions: string[];
  rules: HighlightRule[];
}

export interface TokenRun {
  start: number;
  end: number;
  style: string;
  /** 解析后的前景色（TextMate 路径直接下发；声明式路径缺省 = 渲染层按 style 查主题 syntax 表） */
  color?: string;
}

interface CompiledBlock {
  style: string;
  start: string; // 字面量
  end: string;
}

interface CompiledInline {
  style: string;
  re: RegExp | null; // 锚定用（匹配必须 index===0）
  words: Set<string> | null;
}

export class HighlightService {
  private loaded = false;
  private highlighters: Highlighter[] = [];
  private byExt = new Map<string, Highlighter>();

  constructor(private readonly rulesPath: string) {}

  private ensureLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const doc = JSON.parse(fs.readFileSync(this.rulesPath, "utf8"));
      this.highlighters = (doc.highlighters ?? []) as Highlighter[];
      for (const h of this.highlighters) {
        for (const ext of h.extensions ?? []) this.byExt.set(ext.toLowerCase(), h);
      }
    } catch {
      this.highlighters = [];
    }
  }

  forFile(filePath: string): Highlighter | null {
    this.ensureLoaded();
    return this.byExt.get(path.extname(filePath).toLowerCase()) ?? null;
  }

  /** 逐行着色。返回各行 runs 与跨行块末态（整文件一次传入时调用方无需关心末态）。 */
  highlightLines(
    highlighter: Highlighter,
    lines: string[],
    startBlockStyle: string | null = null,
  ): { lines: TokenRun[][]; endBlockStyle: string | null } {
    const blocks: CompiledBlock[] = [];
    const inline: CompiledInline[] = [];
    for (const r of highlighter.rules ?? []) {
      if (r.blockStart && r.blockEnd) blocks.push({ style: r.style, start: r.blockStart, end: r.blockEnd });
      else if (r.pattern) inline.push({ style: r.style, re: new RegExp(r.pattern), words: null });
      else if (r.keywords?.length) inline.push({ style: r.style, re: null, words: new Set(r.keywords) });
    }

    let inBlock: CompiledBlock | null = blocks.find((b) => b.style === startBlockStyle) ?? null;
    const out: TokenRun[][] = [];

    for (const line of lines) {
      const runs: TokenRun[] = [];
      let i = 0;

      if (inBlock) {
        const stop = line.indexOf(inBlock.end);
        if (stop >= 0) {
          const end = stop + inBlock.end.length;
          runs.push({ start: 0, end, style: inBlock.style });
          inBlock = null;
          i = end;
        } else {
          runs.push({ start: 0, end: line.length, style: inBlock.style });
          out.push(runs);
          continue;
        }
      }

      while (i < line.length) {
        // 块开始（字面量精确锚定在 i）
        const block = blocks.find((b) => line.startsWith(b.start, i));
        if (block) {
          const stop = line.indexOf(block.end, i + block.start.length);
          if (stop >= 0) {
            const end = stop + block.end.length;
            runs.push({ start: i, end, style: block.style });
            i = end;
          } else {
            runs.push({ start: i, end: line.length, style: block.style });
            inBlock = block;
            i = line.length;
          }
          continue;
        }
        // 行内 pattern（声明顺序优先，锚定 index===0）
        let hit: TokenRun | null = null;
        for (const im of inline) {
          if (!im.re) continue;
          im.re.lastIndex = 0;
          const m = im.re.exec(line.slice(i));
          if (m && m.index === 0 && m[0].length > 0) {
            hit = { start: i, end: i + m[0].length, style: im.style };
            break;
          }
        }
        if (hit) {
          runs.push(hit);
          i = hit.end;
          continue;
        }
        // keywords（词首）
        const word = /^\w+/.exec(line.slice(i));
        if (word) {
          const kw = inline.find((im) => im.words?.has(word[0]));
          if (kw) {
            runs.push({ start: i, end: i + word[0].length, style: kw.style });
            i += word[0].length;
            continue;
          }
          // 非关键词词整体跳过（避免逐字符plain碎片）
          runs.push({ start: i, end: i + word[0].length, style: "plain" });
          i += word[0].length;
          continue;
        }
        // 普通字符：并入相邻 plain 段
        const last = runs[runs.length - 1];
        if (last && last.style === "plain" && last.end === i) last.end = i + 1;
        else runs.push({ start: i, end: i + 1, style: "plain" });
        i += 1;
      }
      out.push(runs);
    }
    return { lines: out, endBlockStyle: inBlock?.style ?? null };
  }
}

// 字级 diff：并排模式配对的删除/新增行做 token 级 LCS，输出需要强调的片段集合。
// 简化实现：token 化 + 经典 LCS DP（行短，O(n·m) 可接受）。

export interface WordSpan {
  start: number;
  end: number;
}

// Token 切分（优先级从高到低）：
//   1. 空白串：\s+
//   2. 转义序列：显式识别 JS/TS/C 字符串字面量中的常见转义，避免 LCS 把 \\ 与后续字符
//      拆成两个 token，导致 "hello\n" vs "hello\t" 视觉上只高亮 n/t 两个字母。
//      - 常见 ASCII 转义：\\n \\t \\r \\v \\b \\f \\' \\" \\` \\? \\. \\+ \\* \\^ \\$ \\- 及 \\ \\（双反斜杠）
//      - 十六进制：\\x[0-9a-fA-F]{1,2}
//      - Unicode：\\u[0-9a-fA-F]{4} / \\u{[0-9a-fA-F]+}
//      - UTF-16 小写：\\U[0-9a-fA-F]{8}
//      - 八进制：\\[0-7]{1,3}
//   3. 单词串：[A-Za-z0-9_]+（ASCII \w；不含反斜杠，避免吃掉转义头）
//   4. 单字符兑底（非 ASCII 字符、标点、孤立的 \\）
//
// 全角数字/字母不合并，保留为单字符——全角/半角混写 diff 在字级上就该不同。转义序列中的
// 十六进制字仅取 ASCII 子集，避免把 "\uFF10" 与 "\u0041" 这类不同转义合并为同一 token。
const RE_WS = /^\s+/;
const RE_WORD = /^[A-Za-z0-9_]+/;

// 从位置 i 尝试匹配一个转义序列；命中返回匹配长度，否则返回 0。
// 不用正则：JS 源码里写 \\(反斜杠字符类) 会被转义层双重处理，且 ^ 与 slice 的配合曾出错；
// 用 charCodeAt 直读字节 + 显式分支，保证语义与预期完全一致。
const BS = 92; // '\'
// 常见 ASCII 转义目标字母（n t r v b f ' " ` ? . + * ^ $ -），命中即算转义
// 常见 ASCII 转义目标字符类：n t r v b f ' " ` ? . + * ^ $ -
// 正则里字符类的特殊字符（* + ? ^ $ . 等）已用 \\ 转义
const ESC_CLASS = /^[ntrvbf'\"`?+*^$.-]$/;
const HEX = /[0-9a-fA-F]/;
const OCT = /[0-7]/;

function tryEscape(s: string, i: number): number {
  if (s.charCodeAt(i) !== BS) return 0;
  if (i + 1 >= s.length) return 0;
  const c = s.charCodeAt(i + 1);
  // 常见 ASCII 转义：\\n \\t \\r \\v \\b \\f \\ \\ \` \\? \\+ \\* \\^ \\$ \\.
  // 命中 2 字节，不继续往后看（后面那个字符已被完全“消费”为转义目标）。
  if (ESC_CLASS.test(s.charAt(i + 1))) return 2;
  // 双反斜杠自身也是一对转义序列（字符串字面量 "\\\\" 表示一个真反斜杠）
  if (c === BS) return 2;
  // \\x + 1~2 hex（如 \\x41 / \\x4142）
  if (c === 120 && i + 2 < s.length && HEX.test(s.charAt(i + 2))) {
    let n = 2;
    if (i + 3 < s.length && HEX.test(s.charAt(i + 3))) n++;
    return n;
  }
  // \\u + 4 hex 或 {XXXX+}
  if (c === 117 && i + 2 < s.length) {
    const ch = s.charCodeAt(i + 2);
    if (ch === 123) {
      // \\u{...}: 花括号包围的 hex 序列（ES2015+）
      let n = 3;
      while (n < s.length && s.charCodeAt(i + n) !== 125) {
        if (!HEX.test(s.charAt(i + n))) return 0;
        n++;
      }
      if (n < s.length) n++; // 包含结尾花括号
      return n;
    }
    if (HEX.test(s.charAt(i + 2))) {
      // \\u + 最多 4 hex（不足 4 也当作一个不完整的 unicode 转义，避免拆到单字符）
      let n = 2;
      for (let k = 0; k < 4; k++) {
        if (i + 2 + k >= s.length) break;
        if (!HEX.test(s.charAt(i + 2 + k))) break;
        n++;
      }
      return n;
    }
    return 0;
  }
  // \\U + 8 hex（UTF-32）
  if (c === 85 && i + 2 < s.length && HEX.test(s.charAt(i + 2))) {
    let n = 2;
    for (let k = 0; k < 8; k++) {
      if (i + 2 + k >= s.length) break;
      if (!HEX.test(s.charAt(i + 2 + k))) break;
      n++;
    }
    return n;
  }
  // \\0-\\7 开头，1~3 位八进制（如 \\07 / \\077）
  if (OCT.test(String.fromCharCode(c))) {
    let n = 2;
    while (n - 2 < 3 && i + n < s.length && OCT.test(s.charAt(i + n))) n++;
    return n;
  }
  return 0; // 非已知转义（如 \\w \\d \\s 正则字符类 / 单字符反斜杠后跟未知字母）→ 单字符兑底
}

function tokenize(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const sub = s.slice(i);
    let m: RegExpExecArray | null;
    if ((m = RE_WS.exec(sub))) {
      out.push(m[0]);
      i += m[0].length;
    } else {
      const escLen = tryEscape(s, i);
      if (escLen > 0) {
        out.push(s.slice(i, i + escLen));
        i += escLen;
        continue;
      }
    }
    if ((m = RE_WORD.exec(sub))) {
      out.push(m[0]);
      i += m[0].length;
    } else {
      out.push(s[i]);
      i++;
    }
  }
  return out;
}

/** 在 old 行文本上标出需要删除强调的片段；new 行同理（调用两次，token 序列需配对传入）。 */
export function wordDiff(oldText: string, newText: string): { oldSpans: WordSpan[]; newSpans: WordSpan[] } {
  if (!oldText || !newText) return { oldSpans: [], newSpans: [] };
  const a = tokenize(oldText);
  const b = tokenize(newText);
  if (a.length * b.length > 100_000) return { oldSpans: [{ start: 0, end: oldText.length }], newSpans: [{ start: 0, end: newText.length }] };

  // LCS DP
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  // 回溯：不等号处 = 非匹配 token → 强调
  const oldSpans: WordSpan[] = [];
  const newSpans: WordSpan[] = [];
  const offsetA: number[] = [];
  let acc = 0;
  for (const t of a) {
    offsetA.push(acc);
    acc += t.length;
  }
  const offsetB: number[] = [];
  acc = 0;
  for (const t of b) {
    offsetB.push(acc);
    acc += t.length;
  }
  const pushSpan = (spans: WordSpan[], start: number, len: number) => {
    const last = spans[spans.length - 1];
    if (last && last.end === start) last.end = start + len;
    else spans.push({ start, end: start + len });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pushSpan(oldSpans, offsetA[i], a[i].length);
      i++;
    } else {
      pushSpan(newSpans, offsetB[j], b[j].length);
      j++;
    }
  }
  while (i < n) {
    pushSpan(oldSpans, offsetA[i], a[i].length);
    i++;
  }
  while (j < m) {
    pushSpan(newSpans, offsetB[j], b[j].length);
    j++;
  }
  return { oldSpans, newSpans };
}

/** 按强调片段切分行文本为渲染段。 */
export function renderSegments(text: string, spans: WordSpan[]): { text: string; emph: boolean }[] {
  if (spans.length === 0) return [{ text, emph: false }];
  const out: { text: string; emph: boolean }[] = [];
  let pos = 0;
  for (const s of spans) {
    if (s.start > pos) out.push({ text: text.slice(pos, s.start), emph: false });
    out.push({ text: text.slice(s.start, s.end), emph: true });
    pos = s.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), emph: false });
  return out;
}

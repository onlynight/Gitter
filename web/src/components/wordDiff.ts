// 字级 diff：并排模式配对的删除/新增行做 token 级 LCS，输出需要强调的片段集合。
// 简化实现：token 化（词/空白/单字符），经典 LCS DP（行短，O(n·m) 可接受）。

export interface WordSpan {
  start: number;
  end: number;
}

function tokenize(s: string): string[] {
  return s.match(/\w+|\s+|./g) ?? [];
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

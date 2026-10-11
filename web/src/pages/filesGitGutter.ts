/**
 * 编辑器 git 行级变更高亮（DiffView 同语义同色调）：
 * 以 HEAD 版本为基线，对当前 model 做行级 Myers diff，命中行画整行背景——
 * 新增/修改行绿底（.gg-line-add）、纯删除点红底（.gg-line-del，悬停显示被删内容）。
 * diff 纯前端计算（基线经 file.content revision=HEAD 一次性拉取）；编辑时防抖重算。
 * 护栏：两侧合计超 2 万行跳过（Myers O(ND) 最坏情况防卡顿）；编辑深度超 4000
 * 回退为整段替换块。
 */
import * as Monaco from "monaco-editor";

type MonacoModel = Monaco.editor.ITextModel;
type IDecoration = Monaco.editor.IModelDeltaDecoration;

/** 单个变更块：a 侧 [aStart,aEnd) ↔ b 侧 [bStart,bEnd)（0-based 半开；某侧可为空） */
interface DiffBlock {
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
}

/** 规模护栏：两侧总行数超过即不做 gutter diff */
const MAX_DIFF_LINES = 20000;
/** Myers 编辑深度护栏：超出按整段替换回退 */
const MAX_EDIT_DISTANCE = 4000;

/** 行级 Myers diff（O(ND)，先去公共前后缀）→ 变更块列表（b 序） */
export function diffBlocks(a: string[], b: string[]): DiffBlock[] {
  // 公共前后缀裁剪（实践上覆盖绝大多数编辑场景，N/M 大幅缩小）
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let aEnd = a.length;
  let bEnd = b.length;
  while (aEnd > pre && bEnd > pre && a[aEnd - 1] === b[bEnd - 1]) {
    aEnd--;
    bEnd--;
  }
  const as = a.slice(pre, aEnd);
  const bs = b.slice(pre, bEnd);
  if (as.length === 0 && bs.length === 0) return [];
  if (as.length === 0) return [{ aStart: pre, aEnd: pre, bStart: pre, bEnd: pre + bs.length }];
  if (bs.length === 0) return [{ aStart: pre, aEnd: aEnd, bStart: pre, bEnd: pre }];

  const spans = myersSpans(as, bs);
  // 平移回全文件坐标
  const shifted = spans.map((s) => ({
    aStart: s.aStart + pre,
    aEnd: s.aEnd + pre,
    bStart: s.bStart + pre,
    bEnd: s.bEnd + pre,
  }));
  // 相邻删/插合并为「修改块」（del+ins 连续 → 一块；纯删/纯插保持单侧空）
  const merged: DiffBlock[] = [];
  for (const s of shifted) {
    const last = merged[merged.length - 1];
    if (last && last.aEnd === s.aStart && last.bEnd === s.bStart) {
      last.aEnd = s.aEnd;
      last.bEnd = s.bEnd;
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

/** Myers 最短编辑脚本回溯：返回中间段的 span 列表（坐标相对 as/bs） */
function myersSpans(as: string[], bs: string[]): DiffBlock[] {
  const n = as.length;
  const m = bs.length;
  const max = n + m;
  if (max > MAX_EDIT_DISTANCE * 2) {
    // 深度护栏：整段替换
    return [{ aStart: 0, aEnd: n, bStart: 0, bEnd: m }];
  }
  const offset = max;
  const v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])) x = v[k + 1 + offset];
      else x = v[k - 1 + offset] + 1;
      let y = x - k;
      while (x < n && y < m && as[x] === bs[y]) {
        x++;
        y++;
      }
      v[k + offset] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }

  // 回溯：每步先走对角线，剩余即一段删（x 走）或插（y 走）
  const spans: DiffBlock[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d];
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && vd[k - 1 + offset] < vd[k + 1 + offset])) prevK = k + 1;
    else prevK = k - 1;
    const prevX = vd[prevK + offset];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
    }
    if (d > 0) {
      if (x > prevX) spans.push({ aStart: prevX, aEnd: x, bStart: y, bEnd: y });
      else spans.push({ aStart: x, aEnd: x, bStart: prevY, bEnd: y });
    }
    x = prevX;
    y = prevY;
  }
  return spans.reverse();
}

/** model → 当前装饰 id 集（下次 deltaDecorations 复用） */
const decorationsByModel = new WeakMap<MonacoModel, string[]>();

/** 悬停被删内容最多展示的行数 */
const MAX_HOVER_LINES = 60;

/**
 * 重算并应用 model 的 git 行级 diff 高亮（整行背景，DiffView 同色调）。
 * @param base HEAD 基线全文；null = 基线未就绪/未启用（清空装饰）；"" = 未跟踪新文件（整文件新增）
 */
export function updateGitGutter(model: MonacoModel, base: string | null): void {
  const old = decorationsByModel.get(model) ?? [];
  if (base === null) {
    if (old.length > 0) model.deltaDecorations(old, []);
    decorationsByModel.delete(model);
    return;
  }

  const a = base.split("\n");
  const b = model.getValue().split("\n");
  let decos: IDecoration[] = [];
  if (a.length + b.length <= MAX_DIFF_LINES) {
    for (const block of diffBlocks(a, b)) {
      const delLines = block.aEnd > block.aStart
        ? a.slice(block.aStart, Math.min(block.aEnd, block.aStart + MAX_HOVER_LINES)) : null;
      const hover = delLines
        ? {
          value:
            "```\n" +
            delLines.join("\n") +
            (block.aEnd - block.aStart > MAX_HOVER_LINES ? "\n…" : "") +
            "\n```",
        }
        : undefined;

      if (block.bEnd > block.bStart) {
        // 缓冲区里存在的行（新增/修改）→ DiffView 绿底整行高亮；带删除侧时悬停看被删内容
        decos.push({
          range: new Monaco.Range(block.bStart + 1, 1, block.bEnd, 1),
          options: { isWholeLine: true, className: "gg-line-add", hoverMessage: hover },
        });
      } else if (hover) {
        // 纯删除：删除点的行红底提示（该行本身未变，悬停看被删内容）
        const line = Math.min(block.bStart + 1, model.getLineCount());
        decos.push({
          range: new Monaco.Range(line, 1, line, 1),
          options: { isWholeLine: true, className: "gg-line-del", hoverMessage: hover },
        });
      }
    }
  }
  decorationsByModel.set(model, model.deltaDecorations(old, decos));
}

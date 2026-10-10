/**
 * 表格预览（office-integration-plan.md §10.4）：SheetJS 解析 xlsx/xlsm/xltx/ods
 * （二进制）与 csv/tsv（文本，分隔符自动嗅探），自绘 HTML 表格——列宽（!cols.wpx）、
 * 合并单元格（!merges → rowspan/colspan）、数字格式（cell.w 缓存格式）。
 * 行列护栏防 DOM 风暴（§9.9 教训）：超限截断并给提示行。
 */
import * as XLSX from "xlsx";

/** DOM 护栏：超过即截断（xlsx 全表 104 万行 × 15px 正常，但 DOM 提交不受控） */
const MAX_ROWS = 5000;
const MAX_COLS = 120;

export function renderSheet(
  root: HTMLElement,
  data: Uint8Array | string,
  _name: string,
): { sheets?: string[] } {
  const wb = XLSX.read(data, { type: typeof data === "string" ? "string" : "array" });
  const names = wb.SheetNames;
  const tabs = document.createElement("div");
  tabs.className = "gpv-sheet-tabs";
  const body = document.createElement("div");
  body.className = "gpv-sheet-body";
  root.appendChild(tabs);
  root.appendChild(body);

  const show = (idx: number) => {
    body.innerHTML = "";
    [...tabs.children].forEach((b, i) => b.classList.toggle("active", i === idx));
    body.appendChild(sheetTable(wb.Sheets[names[idx]], names[idx]));
    body.scrollTop = 0;
  };
  names.forEach((n, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = n;
    b.addEventListener("click", () => show(i));
    tabs.appendChild(b);
  });
  if (names.length > 0) show(0);
  else body.appendChild(emptyHint("(empty workbook)"));
  return { sheets: names };
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ESC[ch]);

function sheetTable(ws: XLSX.WorkSheet, name: string): HTMLElement {
  const ref = ws["!ref"];
  if (!ref) return emptyHint(`${name}: (empty sheet)`);

  const range = XLSX.utils.decode_range(ref);
  const merges = ws["!merges"] ?? [];
  const cols = ws["!cols"] ?? [];

  const spans = new Map<string, { rs: number; cs: number }>();
  const covered = new Set<string>();
  for (const m of merges) {
    spans.set(`${m.s.r}:${m.s.c}`, { rs: m.e.r - m.s.r + 1, cs: m.e.c - m.s.c + 1 });
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r !== m.s.r || c !== m.s.c) covered.add(`${r}:${c}`);
      }
    }
  }

  const maxR = Math.min(range.e.r, range.s.r + MAX_ROWS - 1);
  const maxC = Math.min(range.e.c, range.s.c + MAX_COLS - 1);
  const truncated = maxR < range.e.r || maxC < range.e.c;

  let html = "<table><colgroup>";
  for (let c = range.s.c; c <= maxC; c++) {
    const w = cols[c]?.wpx ?? 88;
    html += `<col style="width:${Math.max(40, Math.min(400, Math.round(w)))}px">`;
  }
  html += "</colgroup>";
  for (let r = range.s.r; r <= maxR; r++) {
    html += "<tr>";
    for (let c = range.s.c; c <= maxC; c++) {
      if (covered.has(`${r}:${c}`)) continue;
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      let attrs = "";
      const span = spans.get(`${r}:${c}`);
      if (span) {
        if (span.rs > 1) attrs += ` rowspan="${Math.min(span.rs, maxR - r + 1)}"`;
        if (span.cs > 1) attrs += ` colspan="${Math.min(span.cs, maxC - c + 1)}"`;
      }
      let text = "";
      let cls = "";
      if (cell) {
        text = cell.w ?? (cell.v == null ? "" : String(cell.v));
        if (cell.t === "n") cls = ' class="num"';
      }
      html += `<td${attrs}${cls}>${esc(text)}</td>`;
    }
    html += "</tr>";
  }
  if (truncated) {
    html += `<tr><td class="hint" colspan="${maxC - range.s.c + 1}">… (${range.e.r + 1 - range.s.r} rows × ${range.e.c + 1 - range.s.c} cols total, preview truncated)</td></tr>`;
  }
  html += "</table>";

  const wrap = document.createElement("div");
  wrap.className = "gpv-sheet-table";
  wrap.innerHTML = html;
  return wrap;
}

function emptyHint(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "gpv-empty";
  el.textContent = text;
  return el;
}

/**
 * 自绘 tooltip 悬浮层（ui-redesign-codex-mockup.html v3）：
 * 全页单实例；按钮/控件带 [data-tip] 属性 → 悬停 300ms 后在目标下方（贴底自动上翻）
 * 弹出提示。样式 = 设计语言（panel2 底 + 边框 + 圆角 6 + 150ms fade/上移入场）；
 * 替代原生 title（系统样式丑、延迟不可控）。reduced-motion 由全局媒体查询归零。
 */
export function installTooltip(): void {
  if (document.querySelector(".gtip")) return;
  const tip = document.createElement("div");
  tip.className = "gtip";
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);

  let cur: Element | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function place(el: Element): void {
    tip.textContent = el.getAttribute("data-tip") ?? "";
    tip.classList.add("show");
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let x = r.left + r.width / 2 - w / 2;
    x = Math.max(6, Math.min(x, window.innerWidth - w - 6));
    let y = r.bottom + 6;
    if (y + h > window.innerHeight - 6) y = r.top - h - 6;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }

  document.addEventListener("mouseover", (e) => {
    const el = (e.target as Element | null)?.closest?.("[data-tip]") ?? null;
    if (el === cur) return;
    cur = el;
    if (timer) clearTimeout(timer);
    tip.classList.remove("show");
    if (el) timer = setTimeout(() => { if (cur === el) place(el); }, 300);
  });
  document.addEventListener("mousedown", () => {
    if (timer) clearTimeout(timer);
    tip.classList.remove("show");
  });
}

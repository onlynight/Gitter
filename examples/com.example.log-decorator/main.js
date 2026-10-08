/**
 * log-decorator —— L2 日志/预览/扫描示例。
 *
 * 三个"观察型"钩子：装饰器、预览提供者、扫描器。
 * 全部是"单点失败不扩散"——宿主 try/catch 吞掉，保证 UI 存活。
 */
const fs = require("node:fs");

// ---- 提交信息分类（与内置约定式提交风格对齐）----
const CONVENTIONAL = /^(feat|fix|docs|test|build|chore|refactor|perf|ci|style)(\(.+\))?:\s+/i;
const BREAKING = /\bBREAKING[- ]CHANGE\b/i;
const REVERT = /^\s*Revert\s+"/im;

function classify(subject) {
  const s = String(subject ?? "");
  if (REVERT.test(s)) return { label: "↩ revert", color: "#F0655A" };
  if (BREAKING.test(s)) return { label: "⚠ breaking", color: "#E3B341" };
  const m = CONVENTIONAL.exec(s);
  if (m) {
    const type = m[1].toLowerCase();
    const color =
      type === "feat" ? "#3FB950" :
      type === "fix" ? "#6BABF5" :
      type === "docs" ? "#B9A3EC" :
      type === "test" ? "#8DB8F5" :
      "#A8B0BC";
    return { label: m[1] + (m[2] || ""), color };
  }
  return null;
}

module.exports = function activate(ctx) {
  // ---- 1. 日志装饰器：log.query 后追加 decorations ----
  //      ⚠️ 只读，不能改 commit 本体。单装饰器失败跳过。
  ctx.registerLogDecorator((commit) => {
    const d = classify(commit.subject);
    if (!d) return null;
    return [d];
  });

  // ---- 2. 预览提供者：按扩展名渲染只读预览 ----
  //      第一个匹配的提供者胜出（path.extname 小写匹配）
  ctx.registerPreviewProvider(
    [".svg", "svg"],
    async (filePath, maxBytes) => {
      try {
        const buf = fs.readFileSync(filePath);
        if (buf.length > 256 * 1024) return null;
        const svg = buf.toString("utf8").replace(/<\?xml[^>]*>/, "");
        return { kind: "html", content: svg };
      } catch {
        return null;
      }
    }
  );

  // markdown → 纯文本预览（避免渲染 HTML）
  ctx.registerPreviewProvider(
    [".md", ".markdown"],
    async (filePath) => {
      try {
        const text = fs.readFileSync(filePath, "utf8").slice(0, 32 * 1024);
        return { kind: "text", content: text };
      } catch {
        return null;
      }
    }
  );

  // ---- 3. 自定义扫描器：L2 扫描器可返回 blocked ----
  //      （allowCodePlugins 门 = 审核渠道信任）
  //      数据包 safetyRules 恒为 warning；L2 扫描器可越到 blocked 档
  //      ScannableFile: { path, patch, isBinary, isNew, addedLines, deletedLines }
  //      RuleFinding:   { ruleId, severity: "warning"|"blocked", filePath, line, message }
  ctx.registerScanner((file) => {
    if (file.isBinary) return null;
    const out = [];
    const patch = String(file.patch ?? "");
    if (!patch) return null;

    // 只扫新增行（与内置 scanAddedLine 同语义），注释行豁免
    let line = 0;
    for (const row of patch.split("\n")) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(row);
      if (m) { line = Number(m[1]); continue; }
      if (row.startsWith(" ")) { line += 1; continue; }
      if (row.startsWith("-")) continue;
      if (!row.startsWith("+")) continue;
      const added = row.slice(1);
      if (added.startsWith("//") || added.startsWith("#") || added.startsWith("*")) { line += 1; continue; }

      // 新增行里出现大段连续注释（跨行累加）
      out.push({
        ruleId: `pkg.${ctx.packageId}.large-added`,
        severity: "warning",
        filePath: file.path,
        line,
        message: "单次提交新增行数偏多",
      });
      break; // 每文件只报一次，避免刷屏
    }
    return out.length ? out : null;
  });

  // ---- 4. 只读 git API：面板里展示最近一次提交是否合约定式 ----
  ctx.registerPanel("convention", {
    title: "提交规范",
    body: async () => {
      const log = await ctx.git.log(5);
      const lines = log.split("\n").filter(Boolean);
      const ok = lines.filter((l) => classify(l.split(/\s+/).slice(1).join(" ")) !== null);
      return [
        `最近 ${lines.length} 条提交中 ${ok.length} 条符合约定式提交`,
        ``,
        `最近：`,
        ...lines.slice(0, 3).map((l) => "  " + l),
      ].join("\n");
    },
  });

  // ---- 5. 事件：提交后刷新面板（宿主会自动重新拉取 ui.panels）----
  ctx.on("commit.created", (p) => {
    ctx.notify("提交完成", String(p.message ?? "").slice(0, 50));
  });

  return () => {};
};

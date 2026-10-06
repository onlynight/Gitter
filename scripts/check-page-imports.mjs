#!/usr/bin/env node
/**
 * 页面零直连守卫（ui-full-pluginization-plan.md R1 验收）：
 * web/src/pages/** 不得直接 import 宿主设施——唯一面 = pageSdk（+ GITTER_KIT 组件）。
 * 禁止：../bridge/client（桥直连）、../state/store（全局状态直读直写）、window.gitter（物理绕过）。
 * 运行：node scripts/check-page-imports.mjs（非零退出 = 违规）
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pagesDir = path.resolve(here, "..", "web", "src", "pages");

const FORBIDDEN = [
  { re: /from\s+["'][^"']*bridge\/client["']/, why: "桥直连（应经 pageSdk.call/on）" },
  { re: /from\s+["'][^"']*state\/store["']/, why: "全局状态直连（应经 pageSdk/useAppState）" },
  { re: /window\.gitter\b/, why: "物理绕过 sdk（in-process 极限之外的自弃行为）" },
];

let violations = 0;
for (const name of fs.readdirSync(pagesDir)) {
  if (!/\.tsx?$/.test(name)) continue;
  const src = fs.readFileSync(path.join(pagesDir, name), "utf8");
  for (const { re, why } of FORBIDDEN) {
    if (re.test(src)) {
      process.stderr.write(`[FAIL] pages/${name}: ${why}` + "\n");
      violations++;
    }
  }
}
if (violations > 0) {
  process.stderr.write(`\n${violations} 处违规——页面宿主面必须收敛到 pageSdk（ui-full-pluginization-plan.md R1）` + "\n");
  process.exit(1);
}
process.stdout.write(`[PASS] 页面零直连守卫（pages/ 全部只经 pageSdk + kit 消费宿主）` + "\n");

/**
 * Gitter 语法插件包无头冒烟（tools/ide-extension）：
 * 以真实 PackageStore + GrammarService 驱动 aura-lang.language / aura-lang.hat-language 两个
 * Gitter 语法包（tools/ide-extension/*）——证明：
 *   ① 两个 manifest 通过宿主同源 zod 校验，kind 推导为 grammar，且默认激活（未被账本禁用）
 *   ② 语法文件经 vscode-textmate 解析出正确 scopeName（source.aura / source.hat）
 *   ③ .aura / .hat 文件真实分词出多个带色的 run（不是降级到声明式引擎或 plain）
 *
 * 配色策略（与 extension-system-v2.md §七一致：高亮器只产语义、主题供颜色）：
 *   - Aura 语法用 Kotlin 风格通用 scope（keyword/string/comment/...），
 *     配色由活动主题提供 → 冒烟喂内置 theme.tm.one-dark-pro 的 tokenColors
 *   - HAT 语法用专属 scope（*.hat），上游自带 colors/hat-colors.json → 冒烟喂该文件
 *
 * 运行：npm run build && node dist/smoke-gitter-exts.js
 * 说明：本冒烟只依赖 tools/ide-extension 下的两个语法包 + 内置主题包，不需要 AuraLang 检出，也不需要 tm-grammars。
 */
import * as fs from "fs";
import * as path from "path";
import { PackageStore } from "./services/extensions/store";
import { GrammarService, buildRawTheme } from "./services/extensions/grammar";

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}

async function main() {
  // __dirname 在构建后是 app/dist，仓库根需向上两级
  const REPO = path.resolve(__dirname, "..", "..");
  const PACKAGES_DIR = path.join(REPO, "tools", "ide-extension");

  // ---- 固件：把 tools/ide-extension 当作单个用户包根喂给 PackageStore（每个子目录 = 一个包）----
  const store = new PackageStore([], [PACKAGES_DIR], "0.1.0", () => ({}));
  const pkgs = store.list();
  const aura = pkgs.find((p) => p.id === "aura-lang.language");
  const hat = pkgs.find((p) => p.id === "aura-lang.hat-language");

  check("两个包都被扫描到", !!aura && !!hat, `扫描到 ${pkgs.length} 个：${pkgs.map((p) => p.id).join(", ")}`);
  check("aura manifest 校验通过且默认激活", aura?.state === "active", aura?.reason ?? "OK");
  check("hat manifest 校验通过且默认激活", hat?.state === "active", hat?.reason ?? "OK");
  check("aura kind 推导为 grammar 且启用", aura?.kinds.includes("grammar") === true && aura?.kindStates.grammar === true,
    JSON.stringify(aura?.kinds));
  check("hat kind 推导为 grammar 且启用", hat?.kinds.includes("grammar") === true && hat?.kindStates.grammar === true,
    JSON.stringify(hat?.kinds));

  const auraRec = store.find("aura-lang.language");
  const hatRec = store.find("aura-lang.hat-language");
  check("contributes.grammars 各 1 项",
    auraRec?.manifest.contributes.grammars.length === 1 && hatRec?.manifest.contributes.grammars.length === 1);
  check("grammar 条目字段齐全（language/scopeName/extensions/path）",
    !!auraRec && !!hatRec &&
    auraRec.manifest.contributes.grammars[0].language === "aura" &&
    auraRec.manifest.contributes.grammars[0].scopeName === "source.aura" &&
    auraRec.manifest.contributes.grammars[0].extensions.includes(".aura") &&
    hatRec.manifest.contributes.grammars[0].language === "hat" &&
    hatRec.manifest.contributes.grammars[0].scopeName === "source.hat" &&
    hatRec.manifest.contributes.grammars[0].extensions.includes(".hat"));

  // ---- 降级链验证：GrammarService 只认 contributes.grammars，声明式/内置都不介入 ----
  const onigWasm = (() => {
    try { return require.resolve("vscode-oniguruma/release/onig.wasm"); } catch { return ""; }
  })();
  if (!onigWasm) {
    check("vscode-oniguruma WASM 可用", false, "app 依赖未安装，跳过分词断言");
    return finish();
  }

  // 内置语法根留空：证明完全走用户包路径，无 tm-grammars 兜底
  const svc = new GrammarService(store, "", onigWasm);
  svc.registerUserGrammars();

  // 主题配色：Aura 走内置 One Dark Pro（Kotlin 风格通用 scope），HAT 走上游自带 colors/hat-colors.json
  const oneparkPath = path.join(REPO, "app", "resources", "packages", "theme.tm.one-dark-pro", "theme", "theme.json");
  const oneDark = fs.existsSync(oneparkPath) ? JSON.parse(fs.readFileSync(oneparkPath, "utf8")) : null;
  const hatColorsPath = path.join(PACKAGES_DIR, "hat-vscode-extension", "colors", "hat-colors.json");
  const hatColors = fs.existsSync(hatColorsPath) ? JSON.parse(fs.readFileSync(hatColorsPath, "utf8")) : null;

  check("内置 One Dark Pro tokenColors 可用（供 Aura 通用 scope 配色）", !!oneDark?.tokenColors?.length,
    oneDark?.tokenColors ? `${oneDark.tokenColors.length} 条规则` : "缺失");
  check("hat-colors.json 提供 tokenColors（HAT 专属 scope）", !!hatColors?.tokenColors?.length,
    hatColors?.tokenColors ? `${hatColors.tokenColors.length} 条规则` : "缺失");

  const theme = (name: string, tokenColors: unknown) => buildRawTheme({
    activeId: name,
    syntax: {},
    tokens: { "--c-text": "#CDD6F4" },
    tokenColors: tokenColors as never,
  });
  const auraTheme = theme("aura-lang.language", oneDark?.tokenColors ?? null);
  const hatTheme = theme("aura-lang.hat-language", hatColors?.tokenColors ?? null);

  const auraSample = [
    "package foo.bar",
    "",
    "val WIDTH: Int = 1024",
    "const MAX: Int = 0xFFFF",
    "// 行注释：字符串 \"quoted\" 与 ${WIDTH}",
    'fun greet(name: String): Int = "hi $name".length',
  ].join("\n");
  const hatSample = [
    "; target triple: triple(\"x86_64-linux-gnu\")",
    "; @fn add",
    "    %r = add $i32(%a, %b)",
    '    %s = str "hello"',
    "    ret %r",
  ].join("\n");

  // 串行：GrammarService 共享同一个 Registry，setTheme 是全局状态；
  // 并发高亮两套不同主题会相互覆盖（表现：后到的主题胜出，前者退化为默认色）。
  const auraRes = await svc.highlight("sample.aura", auraSample, auraTheme);
  const hatRes = await svc.highlight("sample.hat", hatSample, hatTheme);

  check("TextMate 分词 .aura", !!auraRes && auraRes.language === "aura",
    auraRes ? `${auraRes.lines.reduce((n, l) => n + l.length, 0)} runs` : "null（降级链被触发）");
  check("TextMate 分词 .hat", !!hatRes && hatRes.language === "hat",
    hatRes ? `${hatRes.lines.reduce((n, l) => n + l.length, 0)} runs` : "null（降级链被触发）");

  // 有实际着色（不是全部退化为默认前景色）——证明 scope → 主题 tokenColors 链路生效
  const auraColors = new Set((auraRes?.lines ?? []).flat().filter((r) => r.color).map((r) => r.color?.toUpperCase()));
  const hatColors_ = new Set((hatRes?.lines ?? []).flat().filter((r) => r.color).map((r) => r.color?.toUpperCase()));
  check("aura 出现多种前景色（scope 命中）", auraColors.size >= 3, [...auraColors].join(" "));
  check("hat 出现多种前景色（scope 命中）", hatColors_.size >= 2, [...hatColors_].join(" "));

  // TokenRun 覆盖整行（不丢字符）
  const covered = (res: { lines: { start: number; end: number }[][] } | null, src: string) =>
    !!res && res.lines.every((lineRuns, i) => {
      const text = src.split("\n")[i];
      if (!lineRuns.length) return text.length === 0;
      return lineRuns[0].start === 0 && lineRuns[lineRuns.length - 1].end === text.length;
    });
  check("aura TokenRun 覆盖整行", covered(auraRes, auraSample));
  check("hat TokenRun 覆盖整行", covered(hatRes, hatSample));

  // 无注册扩展名 → null（降级链入口行为不变）
  check("未知扩展名 → null（降级链）", await svc.highlight("data.xyzzy", "hello", auraTheme) === null);

  // 停用 grammar kind 后应下线（账本 kinds.grammar=false → 无语法 → null）
  const storeOff = new PackageStore(
    [], [PACKAGES_DIR], "0.1.0",
    () => ({ "aura-lang.language": { kinds: { grammar: false } }, "aura-lang.hat-language": { kinds: { grammar: false } } }),
  );
  const svcOff = new GrammarService(storeOff, "", onigWasm);
  svcOff.registerUserGrammars();
  check("grammar kind 禁用 → 语法下线", await svcOff.highlight("sample.aura", auraSample, auraTheme) === null);

  return finish();
}

function finish(): void {
  const code = failures === 0 ? 0 : 1;
  console.log(failures === 0 ? "\n全部通过 ✓" : `\n${failures} 项失败 ✗`);
  // 注：用户语法包加载后，Node 在 Windows 上退出时 libuv async handle 会与 WASM 内部定时器竞态，
  // 表现为 “Assertion failed: UV_HANDLE_CLOSING”。setImmediate 让 WASM 侧微任务/回调排空后再退。
  setImmediate(() => process.exit(code));
}

void main().catch((e) => {
  console.error("冒烟崩溃:", e);
  process.exit(1);
});

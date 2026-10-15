// 一次性迁移工具：内置 Monarch TS 定义 → 插件包 JSON（tools/plugins/aura-lang.*）。
// 源 = web/src/libs/monarch/{hat,aura}.ts（迁移后删除，JSON 成为准源）。
// 校验：JSON 往返后与 TS 定义深比较（RegExp 归一为 source）。
import { readdirSync, mkdirSync, cpSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const userDataPkgs = join(process.env.APPDATA ?? join(process.env.HOME ?? "", "AppData", "Roaming"), "Gitter", "packages");

const regReplacer = (_k, v) => (v instanceof RegExp ? v.source : v);

function normalize(v) {
  // 深比较前的归一：RegExp → source（与 JSON 化对齐）
  if (v instanceof RegExp) return v.source;
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      const nv = normalize(val);
      if (nv !== undefined) out[k] = nv;
    }
    return out;
  }
  return v === undefined ? undefined : v;
}

function assertRoundTrip(name, tsDef, jsonText, strictFlags = true) {
  const parsed = JSON.parse(jsonText);
  const a = JSON.stringify(normalize(tsDef));
  const b = JSON.stringify(parsed);
  if (a !== b) throw new Error(`${name}: JSON 往返与 TS 定义不一致`);
  // flags 检查：Monarch 正则只保留 source，带 flags 会丢语义（language-configuration 的
  // wordPattern /g 无行为差异，允许丢弃）
  const stack = [tsDef];
  while (stack.length) {
    const v = stack.pop();
    if (v instanceof RegExp && v.flags) {
      if (strictFlags) throw new Error(`${name}: 存在带 flags(${v.flags}) 的正则——JSON 无法表达，需人工处理`);
      console.log(`  ⚠ ${name}: 丢弃正则 flags(${v.flags})——language-configuration 语义无影响`);
    }
    if (v && typeof v === "object") stack.push(...Object.values(v));
  }
  console.log(`  ✓ ${name} 往返一致（${(jsonText.length / 1024).toFixed(1)}KB）`);
}

const jobs = [
  {
    ts: "./web/src/libs/monarch/hat.ts",
    pkgId: "aura-lang.hat-language",
    langId: "hat",
    extensions: [".hat"],
  },
  {
    ts: "./web/src/libs/monarch/aura.ts",
    pkgId: "aura-lang.language",
    langId: "aura",
    extensions: [".aura"],
  },
];

for (const job of jobs) {
  console.log(`== ${job.pkgId}`);
  const mod = await import(pathToFileURL(join(root, job.ts)).href);
  const language = job.langId === "hat" ? mod.hatLanguage : mod.auraLanguage;
  const conf = job.langId === "hat" ? mod.hatConf : mod.auraConf;

  const monarchJson = JSON.stringify(language, regReplacer, 2);
  assertRoundTrip(`${job.langId} monarch`, language, monarchJson);
  const confJson = JSON.stringify(conf, regReplacer, 2);
  assertRoundTrip(`${job.langId} conf`, conf, confJson, false);

  // 包源 = userData 已装包（tmLanguage/snippets/colors 为既有资产），叠加 monarch 产物
  const src = join(userDataPkgs, job.pkgId);
  if (!existsSync(src)) throw new Error(`userData 包不存在: ${src}`);
  const out = join(root, "tools", "plugins", job.pkgId);
  mkdirSync(out, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name === "manifest.json") continue;
    cpSync(join(src, entry.name), join(out, entry.name), { recursive: true });
  }

  const manifest = JSON.parse(readFileSync(join(src, "manifest.json"), "utf8"));
  writeFileSync(join(out, "syntaxes", `${job.langId}.monarch.json`), monarchJson + "\n");
  writeFileSync(join(out, "syntaxes", `${job.langId}.language-configuration.json`), confJson + "\n");

  // manifest 升级：版本 +1 位 minor、追加 monarchLanguages 贡献
  const ver = manifest.version.split(".").map(Number);
  ver[1] += 1;
  manifest.version = ver.join(".");
  manifest.contributes.monarchLanguages = [
    { id: job.langId, extensions: job.extensions, monarch: `syntaxes/${job.langId}.monarch.json`, languageConfiguration: `syntaxes/${job.langId}.language-configuration.json` },
  ];
  manifest.description += " 含渲染进程 Monarch 语法（contributes.monarchLanguages，由内置版迁移）。";
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`  ✓ 包源写入 ${out}（v${manifest.version}）`);
}


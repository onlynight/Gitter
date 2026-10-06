#!/usr/bin/env node
/**
 * 插件脚手架生成器（extension-system-v2.md §16.6 G 阶段）：
 * 产出一个可安装的 L1+L2 示例包骨架（命令/技能/配置/i18n/L2 entry）。
 * 用法：node scripts/gen-plugin-scaffold.mjs <输出目录> [包id=com.example.myplugin]
 */
import * as fs from "node:fs";
import * as path from "node:path";

const outDir = process.argv[2];
if (!outDir) {
  console.error("用法: node scripts/gen-plugin-scaffold.mjs <输出目录> [包id]");
  process.exit(1);
}
const id = process.argv[3] ?? "com.example.myplugin";
if (!/^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/.test(id)) {
  console.error("包 id 必须是反向域名（com.example.myplugin）");
  process.exit(1);
}

const files = {
  "manifest.json": {
    schemaVersion: 2,
    id,
    name: "My Plugin",
    version: "0.1.0",
    description: "由脚手架生成的示例插件",
    contributes: {
      commands: [
        {
          id: "hello",
          title: "%cmd.hello%",
          when: "repoOpen",
          action: "terminal.run",
          args: { command: "echo hello from ${repo.branch}" },
        },
      ],
      configuration: [{ key: "greeting", type: "string", default: "hello", title: "问候语" }],
      skills: [
        {
          id: "etiquette",
          name: "My Plugin 礼仪",
          description: "回复时保持简洁并给出 git 建议",
          instructions: "回答保持三句话以内；涉及提交时建议 conventional commit 前缀。",
          tools: [],
        },
      ],
    },
  },
  "main.js": [
    "// L2 受信代码插件（settings.allowCodePlugins 开启后装载）",
    "module.exports = function activate(ctx) {",
    "  ctx.registerStatusItem('hello', { text: '⭐ my-plugin', tooltip: '" + id + "' });",
    "  ctx.on('commit.created', (p) => ctx.notify('提交完成', String(p.message || '').slice(0, 40)));",
    "  return () => { /* dispose */ };",
    "};",
    "",
  ].join("\n"),
  "i18n/zh-Hans.json": JSON.stringify({ "cmd.hello": "示例问候" }, null, 2) + "\n",
  "i18n/en.json": JSON.stringify({ "cmd.hello": "Say hello" }, null, 2) + "\n",
  "README.md": `# ${id}\n\n脚手架示例包：命令（终端动作）+ 技能 + 配置 + i18n + L2 entry。\n安装：打包为 zip 改后缀 .gpk，或目录放入 userData/packages/。\n`,
};

fs.mkdirSync(outDir, { recursive: true });
for (const [rel, content] of Object.entries(files)) {
  const f = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
}
console.log(`脚手架已生成 → ${outDir}（包 id: ${id}）`);
console.log("下一步：改 manifest → 打包 zip 改 .gpk → Gitter 设置 → 扩展 → 导入");

#!/usr/bin/env node
// Gitter 图标构建 — 唯一渲染源：design/icon/gitter-icon.svg（resvg 光栅化，几何零偏差）。
// 产出：design/icon/png/gitter-{size}.png、app/build/icon.{ico,png}、app/resources/icons/gitter.png、
//       web/public/gitter-logo.svg + favicon.svg
// 用法：node scripts/build-icon.mjs（需先 `npm i` 于 scripts/，ICO/预览板步骤自动调用 python）
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svgPath = join(root, "design", "icon", "gitter-icon.svg");
const pngDir = join(root, "design", "icon", "png");
const svg = readFileSync(svgPath, "utf8");

mkdirSync(pngDir, { recursive: true });
mkdirSync(join(root, "app", "build"), { recursive: true });
mkdirSync(join(root, "app", "resources", "icons"), { recursive: true });

const sizes = [1024, 512, 256, 128, 64, 48, 32, 24, 16];
for (const size of sizes) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
  writeFileSync(join(pngDir, `gitter-${size}.png`), png);
}

// electron-builder（buildResources=app/build）：icon.ico / icon.png
copyFileSync(join(pngDir, "gitter-256.png"), join(root, "app", "build", "icon.png"));
// 运行时窗口/任务栏图标（dev 模式；resources/** 已随应用打包）
copyFileSync(join(pngDir, "gitter-256.png"), join(root, "app", "resources", "icons", "gitter.png"));
// 应用内品牌位与 favicon（矢量，明暗底通用）
copyFileSync(svgPath, join(root, "web", "public", "gitter-logo.svg"));
copyFileSync(svgPath, join(root, "web", "public", "favicon.svg"));

// ICO（多尺寸目录）与预览板交由 Pillow 组装
execFileSync("python", [join(root, "scripts", "icon-ico.py")], { stdio: "inherit" });
console.log("icon build OK");

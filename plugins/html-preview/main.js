var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// plugins/html-preview/src/main.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
var DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
function activate(ctx) {
  ctx.registerPreviewProvider([".html", ".htm"], (filePath, opts) => {
    const repo = opts?.repo;
    if (!repo) return null;
    const abs = path.resolve(repo, filePath);
    const rel = path.relative(repo, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      return null;
    }
    if (!stat.isFile()) return null;
    const cap = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
    if (stat.size > cap) {
      return { kind: "text", content: `\u6587\u4EF6\u8D85\u8FC7 HTML \u9884\u89C8\u4E0A\u9650\uFF08${Math.round(cap / 1024 / 1024)}MB\uFF09` };
    }
    const src = fs.readFileSync(abs, "utf8").replace(/^\uFEFF/, "");
    return { kind: "html", content: src };
  });
}
module.exports = activate;

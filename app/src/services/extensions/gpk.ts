import * as fs from "fs";
import * as path from "path";
import { unzipSync } from "fflate";
import { normalizeManifest } from "./schema";

/**
 * .gpk 归档（fflate zip 容器，extension-system-v2.md §五/§六 gpk.ts）：
 * 导入 = 解包到 userData/packages/<id>/（同 id 覆盖）；卸载 = 删用户包目录（仅限用户包）。
 * 错误抛带 detail 的普通 Error——bridge.handle 统一提取 detail 回传渲染层。
 */

function fail(message: string, detail?: string): never {
  throw Object.assign(new Error(message), { detail });
}

/** 导入 .gpk：解压 → 校验 manifest → 解包到 userRoot/<id>/（覆盖）。返回包身份。 */
export function importGpkFile(gpkPath: string, userRoot: string): { id: string; name: string; version: string } {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(fs.readFileSync(gpkPath)));
  } catch (e) {
    fail("不是有效的 .gpk 包（zip 解析失败）", (e as Error).message);
  }
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) fail("包内缺少 manifest.json");

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch (e) {
    fail("manifest.json 不是合法 JSON", (e as Error).message);
  }
  const norm = normalizeManifest(raw);
  if (!norm.ok) fail(norm.reason);
  const { manifest } = norm;
  const kinds = [
    manifest.contributes.themes.length && "theme",
    manifest.contributes.grammars.length && "grammar",
    manifest.contributes.commands.length && "commands",
    manifest.contributes.configuration.length && "configuration",
  ].filter(Boolean);
  if (kinds.length === 0) fail("包不含任何可安装内容（contributes 为空）");

  const target = path.join(userRoot, manifest.id);
  // zip-slip 防护：相对路径且不得越出包根
  const files: [string, Uint8Array][] = [];
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith("/")) continue;
    const rel = path.normalize(name).replace(/^[\\/]+/, "");
    if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
    files.push([rel, data]);
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  for (const [rel, data] of files) {
    const dest = path.join(target, rel);
    if (!dest.startsWith(target + path.sep)) continue; // 双保险
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  }
  return { id: manifest.id, name: manifest.name, version: manifest.version };
}

/** 卸载用户包目录。调用方（bridge）负责校验"仅用户包可卸载"。 */
export function uninstallPackageDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

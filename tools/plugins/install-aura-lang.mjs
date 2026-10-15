// 把 tools/plugins/aura-lang.* 安装（覆盖）到 userData/packages——
// 用户包由 PackageStore 启动扫描/ extensions.changed 增量感知，装完重启应用生效。
import { readdirSync, cpSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const userDataPkgs = join(process.env.APPDATA ?? join(process.env.HOME ?? "", "AppData", "Roaming"), "Gitter", "packages");

for (const name of readdirSync(join(root, "tools", "plugins"), { withFileTypes: true })) {
  if (!name.isDirectory() || !name.name.startsWith("aura-lang.")) continue;
  const src = join(root, "tools", "plugins", name.name);
  const dst = join(userDataPkgs, name.name);
  if (!existsSync(userDataPkgs)) throw new Error(`userData packages 目录不存在: ${userDataPkgs}（先启动一次应用）`);
  cpSync(src, dst, { recursive: true });
  console.log(`installed ${name.name} → ${dst}`);
}

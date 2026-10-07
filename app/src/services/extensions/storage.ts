import * as fs from "fs";
import * as path from "path";

/**
 * 插件隔离 KV 存储（extension-system-v2.md §16.5 C 阶段 ctx.storage 接缝）：
 * 每包一个 JSON 文件（userData/plugin-data/<packageId>.json），插件互相不可见。
 */
export class PluginStorage {
  constructor(private readonly dir: string) {}

  private fileOf(packageId: string): string {
    const safe = packageId.replace(/[^a-zA-Z0-9.-]/g, "_");
    return path.join(this.dir, `${safe}.json`);
  }

  get(packageId: string): Record<string, unknown> {
    try {
      return JSON.parse(fs.readFileSync(this.fileOf(packageId), "utf8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  getKey(packageId: string, key: string): unknown {
    return this.get(packageId)[key];
  }

  set(packageId: string, key: string, value: unknown): void {
    const data = this.get(packageId);
    data[key] = value;
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.fileOf(packageId), JSON.stringify(data, null, 2), "utf8");
  }
}

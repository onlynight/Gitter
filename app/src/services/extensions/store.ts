import * as fs from "fs";
import * as path from "path";
import * as semver from "semver";
import type { ExtensionPackageDTO } from "../../shared/types";
import { normalizeManifest, type Manifest } from "./schema";

/**
 * PackageStore——插件系统 v2 的唯一自写内核（extension-system-v2.md §六）：
 * 扫描内置/用户根目录 → manifest 校验（zod）→ semver engines 门槛 → 启停账本 → 按 kind 供各消费服务取用。
 * 扫描顺序：用户根优先，同 id 用户包遮蔽内置包（内置只能禁用不能卸载）。
 * 任何包内异常（manifest 损坏等）→ 该包标记 error + 原因，宿主与其它包不受影响。
 */

export interface PackageLedgerEntry {
  enabled?: boolean;
  kinds?: Record<string, boolean>;
  config?: Record<string, unknown>;
}

export type PackagesLedger = Record<string, PackageLedgerEntry>;

export interface PackageRecord {
  manifest: Manifest;
  dir: string;
  isBuiltIn: boolean;
}

interface Entry extends PackageRecord {
  /** manifest 解析失败时为 null（此时 state 恒为 error） */
  state: "active" | "disabled" | "error";
  reason: string | null;
}

const ALL_KINDS = ["theme", "grammar", "commands", "configuration"] as const;
export type ExtensionKind = (typeof ALL_KINDS)[number];

export class PackageStore {
  constructor(
    private readonly builtinRoots: string[],
    private readonly userRoots: string[],
    private readonly appVersion: string,
    private readonly ledgerOf: () => PackagesLedger,
  ) {}

  /** 全量扫描（每次调用重扫——包量小，目录 I/O 便宜，换取导入/卸载后的强一致）。 */
  scanAll(): Entry[] {
    const byId = new Map<string, Entry>();
    const scanRoot = (root: string, isBuiltIn: boolean) => {
      let names: string[] = [];
      try {
        names = fs.readdirSync(root);
      } catch {
        return; // 根目录不存在（如 resources/packages 尚无内容）
      }
      for (const dirName of names) {
        const dir = path.join(root, dirName);
        try {
          if (!fs.statSync(dir).isDirectory()) continue;
        } catch {
          continue;
        }
        // 用户包遮蔽内置包：内置根扫描时跳过已有 id
        if (byId.has(dirName)) continue;
        byId.set(dirName, this.loadEntry(dir, dirName, isBuiltIn));
      }
    };
    for (const r of this.userRoots) scanRoot(r, false);
    for (const r of this.builtinRoots) scanRoot(r, true);
    return [...byId.values()];
  }

  private loadEntry(dir: string, dirName: string, isBuiltIn: boolean): Entry {
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
    } catch (e) {
      return { manifest: null as unknown as Manifest, dir, isBuiltIn, state: "error", reason: `manifest.json 读取失败：${(e as Error).message}` };
    }
    const norm = normalizeManifest(raw);
    if (!norm.ok) {
      return { manifest: null as unknown as Manifest, dir, isBuiltIn, state: "error", reason: norm.reason };
    }
    const { manifest } = norm;
    const range = manifest.engines?.gitter;
    if (range) {
      const valid = semver.validRange(range);
      if (!valid) {
        return { manifest, dir, isBuiltIn, state: "error", reason: `engines.gitter 不是合法 semver 区间：${range}` };
      }
      if (!semver.satisfies(this.appVersion, valid, { includePrerelease: true })) {
        // v1 设计：宿主版本不满足 → 禁用（不删除），设置页可见原因
        return { manifest, dir, isBuiltIn, state: "disabled", reason: `需要 Gitter ${range}（当前 ${this.appVersion}）` };
      }
    }
    const ledger = this.ledgerOf()[manifest.id];
    if (ledger?.enabled === false) {
      return { manifest, dir, isBuiltIn, state: "disabled", reason: null };
    }
    return { manifest, dir, isBuiltIn, state: "active", reason: null };
  }

  private kindsOf(e: Entry): string[] {
    if (!e.manifest) return [];
    const c = e.manifest.contributes;
    const kinds: string[] = [];
    if (c.themes.length) kinds.push("theme");
    if (c.grammars.length) kinds.push("grammar");
    if (c.commands.length) kinds.push("commands");
    if (c.configuration.length) kinds.push("configuration");
    return kinds;
  }

  list(): ExtensionPackageDTO[] {
    return this.scanAll().map((e) => {
      const kinds = this.kindsOf(e);
      const ledger = e.manifest ? this.ledgerOf()[e.manifest.id] : undefined;
      const kindStates: Record<string, boolean> = {};
      for (const k of kinds) {
        kindStates[k] = e.state === "active" && ledger?.kinds?.[k] !== false;
      }
      return {
        id: e.manifest?.id ?? `(损坏包) ${path.basename(e.dir)}`,
        name: e.manifest?.name ?? path.basename(e.dir),
        version: e.manifest?.version ?? "",
        description: e.manifest?.description ?? null,
        isBuiltIn: e.isBuiltIn,
        kinds,
        state: e.state,
        reason: e.reason,
        kindStates,
        configuration: e.manifest?.contributes.configuration.map((c) => ({
          key: c.key, type: c.type, default: c.default, title: c.title,
        })) ?? [],
      };
    });
  }

  /** 供消费服务（Theme/Grammar）查找包：解析失败/禁用的包返回 null（调用方走内置兜底）。 */
  find(id: string): PackageRecord | null {
    const hit = this.scanAll().find((e) => e.manifest?.id === id);
    if (!hit || hit.state !== "active") return null;
    return { manifest: hit.manifest, dir: hit.dir, isBuiltIn: hit.isBuiltIn };
  }

  /** 包 active 且该 kind 未被单独禁用。 */
  kindEnabled(id: string, kind: ExtensionKind): boolean {
    const hit = this.scanAll().find((e) => e.manifest?.id === id);
    if (!hit || hit.state !== "active") return false;
    return this.ledgerOf()[id]?.kinds?.[kind] !== false;
  }

  /** 包配置（contributes.configuration 的运行值，来自账本，缺省用 manifest default）。 */
  configOf(id: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const hit = this.scanAll().find((e) => e.manifest?.id === id);
    if (hit?.manifest) {
      for (const item of hit.manifest.contributes.configuration) {
        out[item.key] = item.default;
      }
    }
    return { ...out, ...this.ledgerOf()[id]?.config };
  }
}

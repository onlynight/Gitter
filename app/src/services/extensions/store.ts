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

const ALL_KINDS = [
  "theme", "grammar", "commands", "configuration",
  "menus", "keybindings", "terminalProfiles", "safetyRules",
  "skills", "mcpServers", "emptyHints", "pages",
  "harness", "models", "taskTypes",
] as const;
export type ExtensionKind = (typeof ALL_KINDS)[number];

/** 宿主支持的插件 API 版本（G 阶段 apiVersion 冻结策略：只拒高不拒低）。 */
export const HOST_API_VERSION = 3;

/** 旧包 id → 新 id（U 分类命名迁移：theme.gitui.* 等；settings.themePackageId 与启停账本按此续接）。 */
export const LEGACY_ID_ALIASES: Record<string, string> = {
  "gitui.theme.dark": "theme.gitui.dark",
  "gitui.theme.light": "theme.gitui.light",
};

export function canonicalPackageId(id: string): string {
  return LEGACY_ID_ALIASES[id] ?? id;
}

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
    if (manifest.apiVersion !== null && manifest.apiVersion > HOST_API_VERSION) {
      return { manifest, dir, isBuiltIn, state: "disabled", reason: `插件 API v${manifest.apiVersion} 超出宿主支持（当前 v${HOST_API_VERSION}），请升级 Gitter` };
    }
    const ledger = this.ledgerEntry(manifest.id);
    if (ledger?.enabled === false) {
      return { manifest, dir, isBuiltIn, state: "disabled", reason: null };
    }
    return { manifest, dir, isBuiltIn, state: "active", reason: null };
  }

  /** 账本条目（新 id 优先；旧 id 键的遗留条目并入，保住用户的历史启停/配置）。 */
  private ledgerEntry(id: string): PackageLedgerEntry | undefined {
    const ledger = this.ledgerOf();
    const legacyKey = Object.keys(LEGACY_ID_ALIASES).find((oldId) => LEGACY_ID_ALIASES[oldId] === id);
    const legacy = legacyKey ? ledger[legacyKey] : undefined;
    return { ...(legacy ?? {}), ...(ledger[id] ?? {}) };
  }

  private kindsOf(e: Entry): string[] {
    if (!e.manifest) return [];
    const c = e.manifest.contributes;
    const kinds: string[] = [];
    if (c.themes.length) kinds.push("theme");
    if (c.grammars.length) kinds.push("grammar");
    if (c.commands.length) kinds.push("commands");
    if (c.configuration.length) kinds.push("configuration");
    if (c.harnesses.length) kinds.push("harness");
    if (c.models.length) kinds.push("models");
    if (c.taskTypes.length) kinds.push("taskTypes");
    if (c.menus.length) kinds.push("menus");
    if (c.keybindings.length) kinds.push("keybindings");
    if (c.terminalProfiles.length) kinds.push("terminalProfiles");
    if (c.safetyRules.length) kinds.push("safetyRules");
    if (c.skills.length) kinds.push("skills");
    if (c.mcpServers.length) kinds.push("mcpServers");
    if (c.emptyHints.length) kinds.push("emptyHints");
    if (c.pages.length) kinds.push("pages");
    return kinds;
  }

  list(): ExtensionPackageDTO[] {
    return this.scanAll().map((e) => {
      const kinds = this.kindsOf(e);
      const ledger = e.manifest ? this.ledgerEntry(e.manifest.id) : undefined;
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
        permissions: e.manifest?.permissions ?? [],
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
    return this.ledgerEntry(id)?.kinds?.[kind] !== false;
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
    return { ...out, ...this.ledgerEntry(id)?.config };
  }

  /** 终端档位包（terminalProfiles 接缝，A 阶段）。id 运行时形式 = ext.<packageId>.<profileId>。 */
  terminalProfiles(): { id: string; name: string; command: string; args: string[] }[] {
    const out: { id: string; name: string; command: string; args: string[] }[] = [];
    for (const e of this.scanAll()) {
      if (e.state !== "active" || !e.manifest) continue;
      const ledger = this.ledgerOf()[e.manifest.id];
      if (ledger?.kinds?.terminalProfiles === false) continue;
      for (const p of e.manifest.contributes.terminalProfiles) {
        out.push({ id: `ext.${e.manifest.id}.${p.id}`, name: `${p.name}（${e.manifest.name}）`, command: p.command, args: [...p.args] });
      }
    }
    return out;
  }

  /** 安全网规则包（safetyRules 接缝，A 阶段）。数据包规则恒为 warning 档（否决权保留给内置规则 + 人审）。 */
  safetyRules(): { packageId: string; id: string; regex: RegExp; message: string; fileExts: string[] }[] {
    const out: { packageId: string; id: string; regex: RegExp; message: string; fileExts: string[] }[] = [];
    for (const e of this.scanAll()) {
      if (e.state !== "active" || !e.manifest) continue;
      const ledger = this.ledgerOf()[e.manifest.id];
      if (ledger?.kinds?.safetyRules === false) continue;
      for (const r of e.manifest.contributes.safetyRules) {
        try {
          // g 全局标志会造成 lastIndex 状态泄漏，强制剥离；其余 flags 放行（i/m/s/y）
          const flags = (r.flags ?? "").replace(/g/g, "");
          out.push({
            packageId: e.manifest.id,
            id: `pkg.${e.manifest.id}.${r.id}`,
            regex: new RegExp(r.pattern, flags),
            message: r.message,
            fileExts: r.fileExts.map((x) => (x.startsWith(".") ? x.toLowerCase() : `.${x.toLowerCase()}`)),
          });
        } catch {
          // 非法正则：跳过该条规则（不影响其它规则，宿主存活）
        }
      }
    }
    return out;
  }

  /** 技能包（skills 接缝，D 阶段）：AgentLoop 注入系统提示的 L1 纯数据。 */
  skillsOf(): { packageId: string; id: string; name: string; description: string; instructions: string; tools: string[] }[] {
    const out: { packageId: string; id: string; name: string; description: string; instructions: string; tools: string[] }[] = [];
    for (const e of this.scanAll()) {
      if (e.state !== "active" || !e.manifest) continue;
      if (this.ledgerOf()[e.manifest.id]?.kinds?.skills === false) continue;
      for (const k of e.manifest.contributes.skills) {
        out.push({
          packageId: e.manifest.id,
          id: `ext.${e.manifest.id}.${k.id}`,
          name: k.name,
          description: k.description,
          instructions: k.instructions,
          tools: [...k.tools],
        });
      }
    }
    return out;
  }

  /** 空状态提示包（emptyHints 接缝，E 阶段收尾）：按插槽返回追加文案。 */
  /** 渲染层页面贡献（pages 接缝，U1）：装载由渲染层 loader 执行（allowCodePlugins 门）。 */
  pagesOf(): { packageId: string; id: string; title: string; entryAbs: string; permissions: string[] }[] {
    const out: { packageId: string; id: string; title: string; entryAbs: string; permissions: string[] }[] = [];
    for (const e of this.scanAll()) {
      if (e.state !== "active" || !e.manifest) continue;
      if (this.ledgerOf()[e.manifest.id]?.kinds?.pages === false) continue;
      for (const pg of e.manifest.contributes.pages) {
        out.push({
          packageId: e.manifest.id,
          id: `ext.${e.manifest.id}.${pg.id}`,
          title: pg.title,
          entryAbs: path.join(e.dir, pg.entry),
          permissions: [...pg.permissions],
        });
      }
    }
    return out;
  }

  emptyHintsOf(slot: "changes.empty" | "log.empty" | "branches.empty"): { packageId: string; text: string }[] {
    const out: { packageId: string; text: string }[] = [];
    for (const e of this.scanAll()) {
      if (e.state !== "active" || !e.manifest) continue;
      if (this.ledgerOf()[e.manifest.id]?.kinds?.emptyHints === false) continue;
      for (const h of e.manifest.contributes.emptyHints) {
        if (h.slot === slot) out.push({ packageId: e.manifest.id, text: h.text });
      }
    }
    return out;
  }

  /** 包声明的外部 MCP server（mcpServers 接缝，B 阶段遗留项）。运行时 id = mcp.<pkg>.<id>。 */
  mcpServersOf(): { id: string; name: string; command: string; args: string[]; description: string | null }[] {
    const out: { id: string; name: string; command: string; args: string[]; description: string | null }[] = [];
    for (const e of this.scanAll()) {
      if (e.state !== "active" || !e.manifest) continue;
      if (this.ledgerOf()[e.manifest.id]?.kinds?.mcpServers === false) continue;
      for (const m of e.manifest.contributes.mcpServers) {
        out.push({
          id: `mcp.${e.manifest.id}.${m.id}`,
          name: `${m.name}（${e.manifest.name}）`,
          command: m.command,
          args: [...m.args],
          description: m.description,
        });
      }
    }
    return out;
  }
}

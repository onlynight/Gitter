import * as fs from "fs";
import * as path from "path";
import type { ThemePackageDTO, ThemeStateDTO, TokenColorDTO } from "../shared/types";
import { canonicalPackageId, type PackageRecord, type PackageStore } from "./extensions/store";

/**
 * 主题服务（theme-framework.md 数据格式兼容；v2 起扫描/校验/启停收编到 PackageStore，
 * extension-system-v2.md §六/§八）：
 * 内置包 = app/resources/themes|packages/<id>/（manifest.json + 主题文档）；
 * 用户包 = userData/themes|packages/<id>/ 同构目录。
 * 主题文档：{id,name,base,inherits,tokens,diff,terminal,syntax,tokenColors?,framework}，
 * 令牌名与 TokenKey 枚举一致；合并顺序 = 继承链自底向上覆盖；tokenColors 为整段替换（VS Code 语义）。
 */
interface ThemeDoc {
  id: string;
  name: string;
  base: "dark" | "light";
  inherits?: string;
  tokens?: Record<string, string>;
  diff?: Record<string, string>;
  terminal?: Record<string, string>;
  syntax?: Record<string, string>;
  tokenColors?: TokenColorDTO[];
}

/** 内置基座缺省令牌（与 TokenRuntime.BuiltinDefaults 一致，装载失败时兜底）。 */
const BUILTIN: Record<"dark" | "light", Record<string, string>> = {
  dark: {
    Base: "#1E1F22", Panel: "#2B2D30", Hover: "#393B40", Selected: "#43454A",
    Border: "#2E3033", BorderStrong: "#43454A", Accent: "#3574F0", AccentHover: "#4682F2",
    AccentPressed: "#2B62C9", AccentSoft: "#333574F0", OnAccent: "#FFFFFF",
    Text: "#DFE1E5", Text2: "#9DA0A8", Text3: "#6F737A",
    Green: "#6FBF73", Red: "#F75464", Amber: "#C8A35F",
    ChipBlueBg: "#334C7DD4", ChipBlueFg: "#8FB8E8", ChipPurpleBg: "#36B080FF", ChipPurpleFg: "#C9A2FF",
  },
  light: {
    Base: "#FFFFFF", Panel: "#F7F8FA", Hover: "#EBECF0", Selected: "#E0E2E8",
    Border: "#E6E7EA", BorderStrong: "#D5D7DB", Accent: "#2B6BE4", AccentHover: "#3D7AEA",
    AccentPressed: "#2359C7", AccentSoft: "#1F2B6BE4", OnAccent: "#FFFFFF",
    Text: "#1F2328", Text2: "#5C6167", Text3: "#9DA0A8",
    Green: "#1A7F37", Red: "#CF222E", Amber: "#96671E",
    ChipBlueBg: "#1A2B6BE4", ChipBlueFg: "#1F5EDD", ChipPurpleBg: "#1A6B1EA0", ChipPurpleFg: "#7A3FC9",
  },
};

/** 内置 syntax 配色兜底（与旧栈深色主题包 syntax 段一致）。 */
const BUILTIN_SYNTAX: Record<string, string> = {
  keyword: "#569CD6", string: "#6A9955", comment: "#6A9955", number: "#B5CEA8",
  type: "#4EC9B0", function: "#DCDCAA", variable: "#9CDCFE", operator: "#D4D4D4", punctuation: "#D4D4D4",
};

export class ThemeService {
  constructor(private readonly store: PackageStore) {}

  /** 主题 kind 处于 active 的包（禁用的包不出现在设置页下拉）。 */
  list(): ThemePackageDTO[] {
    const out: ThemePackageDTO[] = [];
    for (const p of this.store.list()) {
      if (p.state !== "active" || !p.kindStates.theme) continue;
      const rec = this.store.find(p.id);
      if (!rec) continue;
      const base = rec.manifest.contributes.themes[0]?.base;
      out.push({ id: p.id, name: p.name, base: base ?? "dark", isBuiltIn: p.isBuiltIn });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** 解析并合并主题（继承链），tokens 以调用方传入的基座缺省兜底。主题被禁用/找不到 → 内置兜底。 */
  resolve(packageId: string | null, fallbackBase: "dark" | "light"): ThemeStateDTO {
    const chain: ThemeDoc[] = [];
    const seen = new Set<string>();
    // 旧 id 迁移：直接 id 命中优先，未命中再试别名（gitui.theme.* → theme.gitui.*）
    const candidates = [packageId, canonicalPackageId(packageId ?? "")].filter(
      (x): x is string => !!x,
    );
    let cur: PackageRecord | null | undefined;
    for (const c of candidates) {
      if (this.store.kindEnabled(c, "theme")) {
        cur = this.store.find(c);
        if (cur) break;
      }
    }
    while (cur) {
      if (seen.has(cur.manifest.id)) break;
      seen.add(cur.manifest.id);
      const rel = cur.manifest.contributes.themes[0]?.path ?? "theme/theme.json";
      try {
        const doc: ThemeDoc = JSON.parse(fs.readFileSync(path.join(cur.dir, rel), "utf8"));
        chain.unshift(doc);
        cur = doc.inherits && this.store.kindEnabled(doc.inherits, "theme") ? this.store.find(doc.inherits) : undefined;
      } catch {
        break;
      }
    }
    const base: "dark" | "light" = chain.length > 0 ? chain[chain.length - 1].base : fallbackBase;
    const tokens: Record<string, string> = { ...BUILTIN[base] };
    let diff: Record<string, string> = {};
    let terminal: Record<string, string> = {};
    let syntax: Record<string, string> = { ...BUILTIN_SYNTAX };
    let tokenColors: TokenColorDTO[] | undefined;
    for (const doc of chain) {
      Object.assign(tokens, doc.tokens ?? {});
      diff = { ...diff, ...(doc.diff ?? {}) };
      terminal = { ...terminal, ...(doc.terminal ?? {}) };
      syntax = { ...syntax, ...(doc.syntax ?? {}) };
      // VS Code 语义：tokenColors 整段替换（取继承链上最后一个非空段）
      if (doc.tokenColors?.length) tokenColors = doc.tokenColors;
    }
    return { base, activeId: chain.length > 0 ? chain[chain.length - 1].id : null, tokens, diff, terminal, syntax, tokenColors };
  }
}

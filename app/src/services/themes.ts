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

/** 内置基座缺省令牌（与 TokenRuntime.BuiltinDefaults 一致，装载失败时兜底）。
 * Codex 风格色板（ui-redesign-codex-mockup.html）：近单色 + Panel2/Link 两个新 token；
 * Panel2/Link 必须在基座缺省里存在——tm.* 等第三方主题包不携带这两个键，样式层依赖回退。 */
const BUILTIN: Record<"dark" | "light", Record<string, string>> = {
  dark: {
    Base: "#0D0D0D", Panel: "#171717", Panel2: "#202020", Hover: "#272727", Selected: "#333333",
    Border: "#2B2B2B", BorderStrong: "#3E3E3E", Accent: "#EAEAEA", AccentHover: "#FFFFFF",
    AccentPressed: "#C9C9C9", AccentSoft: "#26EAEAEA", OnAccent: "#0D0D0D",
    Text: "#EAEAEA", Text2: "#A0A0A0", Text3: "#6E6E6E", Link: "#6BABF5",
    Green: "#3FB950", Red: "#F0655A", Amber: "#E3B341",
    ChipBlueBg: "#1D2733", ChipBlueFg: "#8DB8F5", ChipPurpleBg: "#241F33", ChipPurpleFg: "#B9A3EC",
  },
  light: {
    Base: "#FFFFFF", Panel: "#F7F7F8", Panel2: "#EFEFF1", Hover: "#EBEBEC", Selected: "#E0E1E3",
    Border: "#E5E5E5", BorderStrong: "#D0D0D0", Accent: "#1B1B1B", AccentHover: "#000000",
    AccentPressed: "#3A3A3A", AccentSoft: "#141B1B1B", OnAccent: "#FFFFFF",
    Text: "#1B1B1B", Text2: "#5C5C5C", Text3: "#8F8F8F", Link: "#0B6BCB",
    Green: "#1A7F37", Red: "#CF222E", Amber: "#BF8700",
    ChipBlueBg: "#DDF4FF", ChipBlueFg: "#0B6BCB", ChipPurpleBg: "#FBEFFF", ChipPurpleFg: "#8250DF",
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

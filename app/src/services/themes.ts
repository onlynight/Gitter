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
  /** 窗口背景材质（文档级可声明；manifest 级 material 优先） */
  material?: "none" | "mica" | "acrylic";
  tokens?: Record<string, string>;
  diff?: Record<string, string>;
  terminal?: Record<string, string>;
  syntax?: Record<string, string>;
  tokenColors?: TokenColorDTO[];
}

/** 内置基座缺省令牌（与 TokenRuntime.BuiltinDefaults 一致，装载失败时兜底）。
 * Codex 风格色板（ui-redesign-codex-mockup.html）：近单色 + Panel2/Link 两个新 token；
 * Panel2/Link 必须在基座缺省里存在——tm.* 等第三方主题包不携带这两个键，样式层依赖回退。
 * 透明度策略（模糊窗口，CSS 原生 #RRGGBBAA）：暗色必须暗色主导（亮壁纸/系统亮色 DWM 底下
 * 低透明度会把暗色洗成中灰、文字失效）——acrylic 暗色 Base 40%、mica 暗色 Base 15%（DWM 材质已随
 * nativeTheme 变暗，低 tint 让壁纸染色可感知）；亮色档保持低透明度（亮色在亮壁纸上是 Windows 11 观感）。表面仅轻微提亮
 * （Panel 8-22%、叠层补偿），层级靠描边。材质关闭时由主进程把 Base 压平为窗口底色。 */
const BUILTIN: Record<"dark" | "light", Record<string, string>> = {
  dark: {
    Base: "#14161B99", Panel: "#FFFFFF0A", Panel2: "#FFFFFF12", Hover: "#FFFFFF14", Selected: "#FFFFFF2B",
    Border: "#FFFFFF21", BorderStrong: "#FFFFFF40", Accent: "#EAEAEA", AccentHover: "#FFFFFF",
    AccentPressed: "#C9C9C9", AccentSoft: "#EAEAEA1F", OnAccent: "#14161B",
    Text: "#EAEAEA", Text2: "#A8B0BC", Text3: "#78828E", Link: "#6BABF5",
    Green: "#3FB950", Red: "#F0655A", Amber: "#E3B341",
    ChipBlueBg: "#25324480", ChipBlueFg: "#8DB8F5", ChipPurpleBg: "#2B244080", ChipPurpleFg: "#B9A3EC",
  },
  light: {
    Base: "#FFFFFF8C", Panel: "#F7F7F814", Panel2: "#EFEFF11F", Hover: "#EBEBEC40", Selected: "#E0E1E359",
    Border: "#E5E5E580", BorderStrong: "#D0D0D0B3", Accent: "#1B1B1B", AccentHover: "#000000",
    AccentPressed: "#3A3A3A", AccentSoft: "#1B1B1B14", OnAccent: "#FFFFFF",
    Text: "#1B1B1B", Text2: "#5C5C5C", Text3: "#8F8F8F", Link: "#0B6BCB",
    Green: "#1A7F37", Red: "#CF222E", Amber: "#BF8700",
    ChipBlueBg: "#DDF4FF66", ChipBlueFg: "#0B6BCB", ChipPurpleBg: "#FBEFFF66", ChipPurpleFg: "#8250DF",
  },
};

/** 内置 syntax 配色兜底（与旧栈深色主题包 syntax 段一致）。 */
const BUILTIN_SYNTAX: Record<string, string> = {
  keyword: "#569CD6", string: "#6A9955", comment: "#6A9955", number: "#B5CEA8",
  type: "#4EC9B0", function: "#DCDCAA", variable: "#9CDCFE", operator: "#D4D4D4", punctuation: "#D4D4D4",
};

/** 默认主题包（未选主题时的内置缺省 = 亚克力；settings.themePackageId 缺省 null 走这里）。 */
export const DEFAULT_THEME_PACKAGE = "theme.gitui.acrylic";

export class ThemeService {
  constructor(private readonly store: PackageStore) {}

  /** 主题 kind 处于 active 的包（禁用的包不出现在设置页下拉）。
   * 多主题包（亮/暗双档）：bases 列出覆盖档位；material 取首个声明（整包一致，schema 校验）。 */
  list(): ThemePackageDTO[] {
    const out: ThemePackageDTO[] = [];
    for (const p of this.store.list()) {
      if (p.state !== "active" || !p.kindStates.theme) continue;
      const rec = this.store.find(p.id);
      if (!rec) continue;
      const entries = rec.manifest.contributes.themes ?? [];
      if (entries.length === 0) continue;
      const bases = entries.map((e) => e.base ?? "dark");
      out.push({
        id: p.id,
        name: p.name,
        base: bases[0],
        bases: [...new Set(bases)],
        material: entries.find((e) => e.material)?.material ?? "none",
        isBuiltIn: p.isBuiltIn,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** 解析并合并主题（继承链），tokens 以调用方传入的基座缺省兜底。主题被禁用/找不到 → 内置兜底。
   * 多主题包：按 fallbackBase（解析后的亮暗）选文档；单文档包忽略 base 直接命中（第三方兼容）。
   * material 从链上首个包（即被选中的包，继承链只贡献令牌）取——窗口效果唯一事实源。 */
  resolve(packageId: string | null, fallbackBase: "dark" | "light"): ThemeStateDTO {
    const chain: ThemeDoc[] = [];
    const seen = new Set<string>();
    let material: "none" | "mica" | "acrylic" = "none";
    let themeId: string | null = null;
    // 未选主题 → 默认包；旧 id 迁移：直接 id 命中优先，未命中再试别名（gitui.theme.* / dark|light → 新三包）
    const raw = packageId ?? DEFAULT_THEME_PACKAGE;
    const candidates = [raw, canonicalPackageId(raw)].filter((x): x is string => !!x);
    let cur: PackageRecord | null | undefined;
    for (const c of candidates) {
      if (this.store.kindEnabled(c, "theme")) {
        cur = this.store.find(c);
        if (cur) break;
      }
    }
    let selectedPackage = true;
    while (cur) {
      if (seen.has(cur.manifest.id)) break;
      seen.add(cur.manifest.id);
      const entries = cur.manifest.contributes.themes ?? [];
      const entry = entries.find((e) => (e.base ?? "dark") === fallbackBase) ?? entries[0];
      if (!entry) break;
      try {
        const doc: ThemeDoc = JSON.parse(fs.readFileSync(path.join(cur.dir, entry.path ?? "theme/theme.json"), "utf8"));
        if (!doc.base) doc.base = entry.base ?? "dark";
        chain.unshift(doc);
        if (selectedPackage) {
          material = entry.material ?? doc.material ?? "none";
          themeId = entry.id ?? doc.id ?? cur.manifest.id;
          selectedPackage = false;
        }
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
    return {
      base,
      activeId: chain.length > 0 ? chain[chain.length - 1].id : null,
      material,
      themeId,
      tokens, diff, terminal, syntax, tokenColors,
    };
  }
}

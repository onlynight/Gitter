import * as fs from "fs";
import * as path from "path";
import type { ThemePackageDTO, ThemeStateDTO } from "../shared/types";

/**
 * 主题服务（theme-framework.md 数据格式兼容）：
 * 内置包 = app/resources/themes/<id>/（manifest.json + theme/theme.json，自旧栈 Packages/ 复制）；
 * 用户包 = userData/themes/<id>/ 同构目录（.gpk 归档导入延后，对等账本见迁移文档）。
 * 主题文档：{id,name,base,inherits,tokens,diff,terminal,syntax,framework}，令牌名与
 * TokenKey 枚举一致；合并顺序 = 继承链自底向上覆盖。
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
  framework?: Record<string, string>;
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

export class ThemeService {
  private packages = new Map<string, { info: ThemePackageDTO; dir: string }>();

  constructor(
    private readonly builtinRoot: string,
    private readonly userRoot: string,
  ) {}

  scan() {
    this.packages.clear();
    for (const [root, isBuiltIn] of [[this.builtinRoot, true], [this.userRoot, false]] as const) {
      let ids: string[] = [];
      try {
        ids = fs.readdirSync(root).filter((d) => {
          try {
            return fs.statSync(path.join(root, d)).isDirectory() && fs.existsSync(path.join(root, d, "manifest.json"));
          } catch {
            return false;
          }
        });
      } catch {
        continue;
      }
      for (const id of ids) {
        try {
          const dir = path.join(root, id);
          const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
          const kinds: string[] = manifest.kinds ?? [];
          if (!kinds.includes("theme")) continue;
          this.packages.set(manifest.id, {
            info: { id: manifest.id, name: manifest.name ?? manifest.id, base: manifest.theme?.base === "light" ? "light" : "dark", isBuiltIn },
            dir,
          });
        } catch {
          // 坏包跳过
        }
      }
    }
  }

  list(): ThemePackageDTO[] {
    this.scan();
    return [...this.packages.values()].map((p) => p.info).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** 解析并合并主题（继承链），tokens 以调用方传入的基座缺省兜底。 */
  resolve(packageId: string | null, fallbackBase: "dark" | "light"): ThemeStateDTO {
    this.scan();
    const chain: ThemeDoc[] = [];
    const seen = new Set<string>();
    let cur = packageId ? this.packages.get(packageId) : undefined;
    while (cur) {
      if (seen.has(cur.info.id)) break;
      seen.add(cur.info.id);
      try {
        const doc: ThemeDoc = JSON.parse(fs.readFileSync(path.join(cur.dir, "theme", "theme.json"), "utf8"));
        chain.unshift(doc);
        cur = doc.inherits ? this.packages.get(doc.inherits) : undefined;
      } catch {
        break;
      }
    }
    const base: "dark" | "light" = chain.length > 0 ? chain[chain.length - 1].base : fallbackBase;
    const tokens: Record<string, string> = { ...BUILTIN[base] };
    let diff: Record<string, string> = {};
    let terminal: Record<string, string> = {};
    for (const doc of chain) {
      Object.assign(tokens, doc.tokens ?? {});
      diff = { ...diff, ...(doc.diff ?? {}) };
      terminal = { ...terminal, ...(doc.terminal ?? {}) };
    }
    return {
      base,
      activeId: chain.length > 0 ? chain[chain.length - 1].id : null,
      tokens,
      diff,
      terminal,
    };
  }
}

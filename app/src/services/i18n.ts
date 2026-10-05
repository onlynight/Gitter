import * as fs from "fs";
import * as path from "path";
import type { I18nDTO } from "../shared/types";

/**
 * 本地化（docs/i18n.md 数据格式兼容）：解析 Strings.tsv（key \t en \t zh-Hans）。
 * 数据文件随 app/resources 分发（与旧栈同一份 TSV，保持单一语言源）。
 * 渲染层选择语言（system 由 navigator.language 解析），主进程只提供字典。
 */
export class I18nService {
  private cache: Record<string, Record<string, string>> = {};

  constructor(private readonly tsvPath: string) {}

  get(lang: "en" | "zh-Hans"): I18nDTO {
    const all = this.load();
    return { lang, strings: all[lang] ?? all["en"] ?? {} };
  }

  private load(): Record<string, Record<string, string>> {
    if (this.cache["en"]) return this.cache;
    const result: Record<string, Record<string, string>> = { en: {}, "zh-Hans": {} };
    try {
      const text = fs.readFileSync(this.tsvPath, "utf8");
      for (const line of text.split(/\r?\n/)) {
        if (!line || line.startsWith("#")) continue;
        const cols = line.split("\t");
        if (cols.length < 3) continue;
        const [key, en, zh] = cols;
        // 值内 \n 转义还原（与 gen-localization.ps1 的写法互逆）
        result["en"][key] = en.replace(/\\n/g, "\n");
        result["zh-Hans"][key] = zh.replace(/\\n/g, "\n");
      }
    } catch {
      // 缺文件：返回空字典，渲染层回退 key 本身
    }
    this.cache = result;
    return result;
  }
}

/** 语言偏好解析（对齐 LanguageService.Normalize 的渲染层版本）。 */
export function resolveLanguage(pref: "system" | "en" | "zh-Hans", navigatorLanguage: string): "en" | "zh-Hans" {
  if (pref === "en" || pref === "zh-Hans") return pref;
  return /^zh\b|^zh-/i.test(navigatorLanguage) ? "zh-Hans" : "en";
}

export function resourcePaths(appRoot: string) {
  return {
    stringsTsv: path.join(appRoot, "resources", "Strings.tsv"),
    themesRoot: path.join(appRoot, "resources", "themes"),
    syntaxRulesPath: path.join(appRoot, "resources", "syntax", "highlighters.json"),
  };
}

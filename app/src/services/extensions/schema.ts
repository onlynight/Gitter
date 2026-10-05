import { z } from "zod";

/**
 * 扩展包 manifest 校验（extension-system-v2.md §五）：
 * schemaVersion 2 = contributes 贡献点；schemaVersion 1（v1 .gpk/目录，extension-package-framework.md §3.3）
 * 走兼容分支——kinds/theme 映射为 contributes.themes，syntax kind 随声明式引擎降级一并忽略。
 * 校验失败 = 拒载 + 错误账本，其余包不受影响。
 */

const ID_RE = /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/; // 反向域名

export interface ThemeContribution {
  path: string;
  base: "dark" | "light" | null;
}

export interface GrammarContribution {
  language: string;
  extensions: string[];
  path: string;
  /** 缺省时从语法文件解析 */
  scopeName: string | null;
}

export interface CommandContribution {
  id: string;
  title: string;
  category: string | null;
  keyHint: string | null;
  when: "repoOpen" | null;
  /** L1 受限命令引用的宿主动作（白名单见 commands.ts HOST_ACTIONS） */
  action: string;
  args: unknown;
}

export interface ConfigItem {
  key: string;
  type: "string" | "boolean" | "number";
  default: string | boolean | number;
  title: string | null;
}

export interface Manifest {
  schemaVersion: 1 | 2;
  id: string;
  name: string;
  version: string;
  description: string | null;
  engines: { gitter?: string } | null;
  contributes: {
    themes: ThemeContribution[];
    grammars: GrammarContribution[];
    commands: CommandContribution[];
    configuration: ConfigItem[];
  };
}

export type ManifestResult = { ok: true; manifest: Manifest } | { ok: false; reason: string };

const manifestV2 = z.object({
  schemaVersion: z.literal(2),
  id: z.string().regex(ID_RE, "id 必须是反向域名（如 com.example.mypack）"),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  engines: z.object({ gitter: z.string().min(1).optional() }).optional(),
  contributes: z
    .object({
      themes: z
        .array(
          z.object({
            path: z.string().min(1),
            base: z.enum(["dark", "light"]).nullish(),
          }),
        )
        .optional(),
      grammars: z
        .array(
          z.object({
            language: z.string().min(1),
            extensions: z.array(z.string().min(1)).min(1),
            path: z.string().min(1),
            scopeName: z.string().min(1).nullish(),
          }),
        )
        .optional(),
      commands: z
        .array(
          z.object({
            id: z.string().min(1),
            title: z.string().min(1),
            category: z.string().nullish(),
            keyHint: z.string().nullish(),
            when: z.enum(["repoOpen"]).nullish(),
            action: z.string().min(1),
            args: z.unknown().optional(),
          }),
        )
        .optional(),
      configuration: z
        .array(
          z.object({
            key: z.string().min(1),
            type: z.enum(["string", "boolean", "number"]),
            default: z.union([z.string(), z.boolean(), z.number()]),
            title: z.string().nullish(),
          }),
        )
        .optional(),
    })
    .optional(),
});

function zodReason(e: z.ZodError): string {
  const first = e.issues[0];
  const at = first?.path?.length ? `（${first.path.join(".")}）` : "";
  return `manifest 校验失败：${first?.message ?? "未知错误"}${at}`;
}

/** 统一入口：v2 严格校验；v1（kinds/theme 形状）兼容映射；都不像 → 拒载。 */
export function normalizeManifest(raw: unknown): ManifestResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: "manifest 不是 JSON 对象" };
  const doc = raw as Record<string, unknown>;

  if (doc.schemaVersion === 2) {
    const r = manifestV2.safeParse(raw);
    if (!r.success) return { ok: false, reason: zodReason(r.error) };
    const c = r.data.contributes ?? {};
    return {
      ok: true,
      manifest: {
        schemaVersion: 2,
        id: r.data.id,
        name: r.data.name,
        version: r.data.version,
        description: r.data.description ?? null,
        engines: r.data.engines ?? null,
        contributes: {
          themes: (c.themes ?? []).map((t) => ({ path: t.path, base: t.base ?? null })),
          grammars: (c.grammars ?? []).map((g) => ({
            language: g.language,
            extensions: g.extensions.map(normExt),
            path: g.path,
            scopeName: g.scopeName ?? null,
          })),
          commands: (c.commands ?? []).map((cmd) => ({
            id: cmd.id,
            title: cmd.title,
            category: cmd.category ?? null,
            keyHint: cmd.keyHint ?? null,
            when: cmd.when ?? null,
            action: cmd.action,
            args: cmd.args,
          })),
          configuration: (c.configuration ?? []).map((cfg) => ({
            key: cfg.key,
            type: cfg.type,
            default: cfg.default,
            title: cfg.title ?? null,
          })),
        },
      },
    };
  }

  // v1 兼容（extension-package-framework.md §3.3）：kinds 数组 + theme.base
  const id = typeof doc.id === "string" ? doc.id : "";
  const name = typeof doc.name === "string" ? doc.name : "";
  if (!id || !name) return { ok: false, reason: "manifest 缺少 id/name" };
  if (!ID_RE.test(id)) return { ok: false, reason: `id 不是反向域名：${id}` };
  const kinds = Array.isArray(doc.kinds) ? doc.kinds.filter((k): k is string => typeof k === "string") : [];
  const themeBase = (doc.theme as { base?: unknown } | undefined)?.base;
  return {
    ok: true,
    manifest: {
      schemaVersion: 1,
      id,
      name,
      version: typeof doc.version === "string" ? doc.version : "0.0.0",
      description: typeof doc.description === "string" ? doc.description : null,
      engines: null,
      contributes: {
        // v1 主题包固定为 theme/theme.json（与现栈 ThemeService 读取路径一致）
        themes: kinds.includes("theme")
          ? [{ path: "theme/theme.json", base: themeBase === "light" ? "light" : themeBase === "dark" ? "dark" : null }]
          : [],
        // v1 syntax kind 随声明式引擎降级为回退层，不再作为扩展点装载
        grammars: [],
        commands: [],
        configuration: [],
      },
    },
  };
}

function normExt(e: string): string {
  return (e.startsWith(".") ? e : `.${e}`).toLowerCase();
}

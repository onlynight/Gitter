import io

# ---- schema: emptyHints + webview 权限 ----
p = 'app/src/services/extensions/schema.ts'
s = io.open(p, encoding='utf-8').read()

old = 'export interface McpServerContribution {'
new = '''export interface EmptyHintContribution {
  /** 插槽：changes.empty / log.empty / branches.empty */
  slot: "changes.empty" | "log.empty" | "branches.empty";
  text: string;
}

export interface McpServerContribution {'''
assert s.count(old) == 1, "s1"
s = s.replace(old, new)

old = '    skills: SkillContribution[];\n    mcpServers: McpServerContribution[];'
new = '    skills: SkillContribution[];\n    mcpServers: McpServerContribution[];\n    emptyHints: EmptyHintContribution[];'
assert s.count(old) == 1, "s2"
s = s.replace(old, new)

old = 'permissions: z.array(z.enum(["storage", "notify", "events", "git.read", "tools", "statusbar"])).nullish(),'
new = 'permissions: z.array(z.enum(["storage", "notify", "events", "git.read", "tools", "statusbar", "webview"])).nullish(),'
assert s.count(old) == 1, "s3"
s = s.replace(old, new)

old = '  permissions: string[];\n  /** 插件 API 版本'
assert s.count(old) == 1, "s4-check"
# Manifest 接口补 emptyHints（permissions 之后、apiVersion 之前的接口区域不影响，找 contributes 块）
old = '    safetyRules: SafetyRuleContribution[];\n    skills: SkillContribution[];\n    mcpServers: McpServerContribution[];'
new = '    safetyRules: SafetyRuleContribution[];\n    skills: SkillContribution[];\n    mcpServers: McpServerContribution[];\n    emptyHints: EmptyHintContribution[];'
assert s.count(old) == 1, "s4"
s = s.replace(old, new)

old = '''      emptyHints: z
        .array(
          z.object({
            slot: z.enum(["changes.empty", "log.empty", "branches.empty"]),
            text: z.string().min(1),
          }),
        )
        .optional(),'''
assert s.count(old) == 0, "s5-pre"
old = '        .optional(),\n      skills:'
new = '''        .optional(),
      emptyHints: z
        .array(
          z.object({
            slot: z.enum(["changes.empty", "log.empty", "branches.empty"]),
            text: z.string().min(1),
          }),
        )
        .optional(),
      skills:'''
i = s.find(old)
assert i > 0, "s5"
s = s.replace(old, new)

old = '''          skills: (c.skills ?? []).map((k) => ({'''
new = '''          emptyHints: (c.emptyHints ?? []).map((h) => ({ slot: h.slot, text: h.text })),
          skills: (c.skills ?? []).map((k) => ({'''
assert s.count(old) == 1, "s6"
s = s.replace(old, new)

old = '        skills: [],\n        mcpServers: [],'
new = '        skills: [],\n        mcpServers: [],\n        emptyHints: [],'
assert s.count(old) == 1, "s7"
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('schema OK')

# ---- store ----
p = 'app/src/services/extensions/store.ts'
s = io.open(p, encoding='utf-8').read()
old = '  "skills", "mcpServers",'
new = '  "skills", "mcpServers", "emptyHints",'
assert s.count(old) == 1, "st1"
s = s.replace(old, new)
old = '    if (c.mcpServers.length) kinds.push("mcpServers");'
new = '    if (c.mcpServers.length) kinds.push("mcpServers");\n    if (c.emptyHints.length) kinds.push("emptyHints");'
assert s.count(old) == 1, "st2"
s = s.replace(old, new)
old = '  /** 包声明的外部 MCP server（mcpServers 接缝，B 阶段遗留项）。运行时 id = mcp.<pkg>.<id>。 */'
new = '''  /** 空状态提示包（emptyHints 接缝，E 阶段收尾）：按插槽返回追加文案。 */
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

  /** 包声明的外部 MCP server（mcpServers 接缝，B 阶段遗留项）。运行时 id = mcp.<pkg>.<id>。 */'''
assert s.count(old) == 1, "st3"
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('store OK')

# ---- host: webview 能力 + L2 registerView ----
p = 'app/src/services/extensions/host.ts'
s = io.open(p, encoding='utf-8').read()
old = '''  /** 侧栏面板（E 阶段插槽：L2 数据供给，渲染层 ui.panels 拉取正文文本） */
  registerPanel(id: string, panel: { title: string; body: (ctx: { repo: string | null }) => Promise<string> | string }): void;
}'''
new = '''  /** 侧栏面板（E 阶段插槽：L2 数据供给，渲染层 ui.panels 拉取正文文本） */
  registerPanel(id: string, panel: { title: string; body: (ctx: { repo: string | null }) => Promise<string> | string }): void;
  /** webview 视图容器（E 阶段收尾：静态 HTML，渲染层沙箱 iframe，无脚本权限） */
  registerView(id: string, view: { title: string; html: string }): void;
}'''
assert s.count(old) == 1, "h1"
s = s.replace(old, new)

old = '  private panels = new Map<string, { owner: string; title: string; body: (ctx: { repo: string | null }) => Promise<string> | string }>();'
new = old + '\n  private views = new Map<string, { owner: string; title: string; html: string }>();'
assert s.count(old) == 1, "h2"
s = s.replace(old, new)

old = '''      registerPanel: (panelId, panel) => {
        const key = `${packageId}/${panelId}`;
        this.panels.set(key, { owner: packageId, title: panel.title, body: panel.body });
        cleanup(() => this.panels.delete(key));
      },
    };'''
new = '''      registerPanel: (panelId, panel) => {
        const key = `${packageId}/${panelId}`;
        this.panels.set(key, { owner: packageId, title: panel.title, body: panel.body });
        cleanup(() => this.panels.delete(key));
      },
      registerView: (viewId, view) => {
        const key = `${packageId}/${viewId}`;
        this.views.set(key, { owner: packageId, title: view.title, html: view.html });
        cleanup(() => this.views.delete(key));
      },
    };'''
assert s.count(old) == 1, "h3"
s = s.replace(old, new)

old = '      case "statusbar": {'
new = '''      case "webview": {
        if (method !== "register") throw new Error(`未知 webview 方法 ${method}`);
        const key = `${packageId}/${String(args.id ?? "view")}`;
        this.views.set(key, { owner: packageId, title: String(args.title ?? "view"), html: String(args.html ?? "") });
        disposables.push(() => this.views.delete(key));
        return null;
      }
      case "statusbar": {'''
assert s.count(old) == 1, "h4"
s = s.replace(old, new)

old = '    this.statusItems.clear();\n    this.panels.clear();'
new = '    this.statusItems.clear();\n    this.panels.clear();\n    this.views.clear();'
assert s.count(old) == 1, "h5"
s = s.replace(old, new)

old = '  /** 面板插槽产物（ui.panels RPC：解析正文，单面板失败不拖累其它）。 */'
new = '''  /** webview 视图产物（ui.views RPC：静态 HTML，渲染层 sandbox iframe 无脚本）。 */
  listViews(): { id: string; title: string; html: string; packageId: string }[] {
    return [...this.views.entries()].map(([id, v]) => ({ id, title: v.title, html: v.html, packageId: v.owner }));
  }

  /** 面板插槽产物（ui.panels RPC：解析正文，单面板失败不拖累其它）。 */'''
assert s.count(old) == 1, "h6"
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('host OK')

# ---- l3-child: registerView ----
p = 'app/src/services/extensions/l3-child.ts'
s = io.open(p, encoding='utf-8').read()
old = '  registerStatusItem(id: string, item: { text: string; tooltip?: string; command?: string }): Promise<void>;\n}'
new = '''  registerStatusItem(id: string, item: { text: string; tooltip?: string; command?: string }): Promise<void>;
  /** webview 视图容器（webview 权限；静态 HTML，渲染层沙箱 iframe 无脚本） */
  registerView(id: string, view: { title: string; html: string }): Promise<void>;
}'''
assert s.count(old) == 1, "l1"
s = s.replace(old, new)
old = "          registerStatusItem: (id, item) => call(\"statusbar\", \"register\", { id, ...item }).then(() => undefined),\n        };"
new = '''          registerStatusItem: (id, item) => call("statusbar", "register", { id, ...item }).then(() => undefined),
          registerView: (id, view) => call("webview", "register", { id, ...view }).then(() => undefined),
        };'''
assert s.count(old) == 1, "l2"
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('l3-child OK')

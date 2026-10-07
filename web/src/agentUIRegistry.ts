import type { ReactNode } from "react";

/**
 * Agent UI 注册表（agent-harness-v4.md §14.6/§20.3.7）：
 * 外部页/包经 window.GITTER_UI.registerAgentUI 贡献时间线卡片渲染器与输入台提供者；
 * 内置实现（gitui.page.tasks 十类展示块 + @文件 provider）与第三方包走同一接缝自举注册。
 *
 * 三级提供者解析（同 uiRegistry 语义）：用户包 > 内置包 > 宿主缺省；
 * 同级内再按特异性（工具精确 > 工具前缀 > blockKind 通配）→ rank → 先注册胜。
 * 纯数据模块；宿主 sdk.ts 安装到 GITTER_UI，页面包经 external/agentUIShim 消费——
 * 页面产物不持有注册表副本（单源）。沙箱约束：渲染走 markdown/主题 token，禁止直接网络请求。
 */

export type AgentUITier = "host" | "builtin" | "user";

/** 页面在渲染调用时附带的环境（内置渲染器的交互回调；外部渲染器可忽略）。 */
export interface TimelineCardCtx {
  /** 选中任务 id（AgentImage 等按任务取数） */
  taskId?: string;
  /** file 块「查看」→ 跳改动页签并选中该文件 */
  viewFile?: (path: string) => void;
  /** turn 块上下文用量文案（宿主轮询 stats） */
  contextPct?: string;
  /** subtask 子块渲染（递归走同一解析管线，含交互卡） */
  renderChildren?: (children: unknown[]) => ReactNode;
}

export interface TimelineCardProps {
  /** 时间线块（只读数据） */
  block: unknown;
  taskId: string;
  /** 展开态受控提示（宿主 details 折叠） */
  expandable?: boolean;
  ctx?: TimelineCardCtx;
}

export interface TimelineRendererDef {
  /** 精确工具名（如 "mydeploy.release"）或包前缀（如 "mydeploy."）；undefined = 按 blockKind 通配 */
  tool?: string;
  blockKind?: string;
  /** 渲染优先级（同特异性同 tier 内，大者胜；同分先注册胜） */
  rank?: number;
  render: (props: TimelineCardProps) => ReactNode;
}

export interface ComposerMentionProviderDef {
  /** 提及前缀（@ 文件为内置；插件可加 #、! 等其它前缀，同 prefix 用户包覆盖内置） */
  prefix: string;
  label: string;
  source: (query: string) => Promise<{ label: string; insert: string }[]>;
}

export interface AgentUIRegistration {
  packageId: string;
  /** 提供者层级：user（用户包）> builtin（内置包）> host（宿主缺省自举） */
  tier: AgentUITier;
  timelineRenderers: TimelineRendererDef[];
  composerProviders: ComposerMentionProviderDef[];
}

interface Scored {
  def: TimelineRendererDef;
  spec: number;
  tier: number;
  rank: number;
}

const TIER_ORDER: Record<AgentUITier, number> = { host: 1, builtin: 2, user: 3 };

const registrations = new Map<string, AgentUIRegistration>();
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version++;
  for (const fn of listeners) fn();
}

export function registerAgentUI(reg: AgentUIRegistration): void {
  registrations.set(reg.packageId, reg);
  notify();
}

export function unregisterAgentUI(packageId: string): void {
  if (!registrations.delete(packageId)) return;
  notify();
}

export function onAgentUIChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function agentUIVersion(): number {
  return version;
}

function better(a: Scored, b: Scored | null): boolean {
  if (!b) return true;
  if (a.spec !== b.spec) return a.spec > b.spec;
  if (a.tier !== b.tier) return a.tier > b.tier;
  return a.rank > b.rank;
}

/** 时间线渲染器解析：工具精确 > 工具前缀 > blockKind 通配；同级 用户包 > 内置包 > 宿主；再比 rank。 */
export function resolveTimelineRenderer(toolName: string | undefined, blockKind: string): TimelineRendererDef | null {
  let winner: Scored | null = null;
  for (const reg of registrations.values()) {
    for (const r of reg.timelineRenderers) {
      let spec: number;
      if (r.tool && toolName) {
        if (toolName === r.tool) spec = 3;
        else if (toolName.startsWith(r.tool)) spec = 2;
        else continue;
      } else if (!r.tool && r.blockKind === blockKind) {
        spec = 1;
      } else continue;
      const s: Scored = { def: r, spec, tier: TIER_ORDER[reg.tier], rank: r.rank ?? 0 };
      if (better(s, winner)) winner = s;
    }
  }
  return winner?.def ?? null;
}

/** 输入台提及提供者：同 prefix 用户包 > 内置包 > 宿主（@ 文件为内置自举）。 */
export function composerProviders(): ComposerMentionProviderDef[] {
  const best = new Map<string, { provider: ComposerMentionProviderDef; tier: number }>();
  for (const reg of registrations.values()) {
    for (const p of reg.composerProviders) {
      const tier = TIER_ORDER[reg.tier];
      const cur = best.get(p.prefix);
      if (!cur || tier > cur.tier) best.set(p.prefix, { provider: p, tier });
    }
  }
  return [...best.values()].map((s) => s.provider);
}

/** 活跃注册（设置页贡献审计/调试：逐包可见层级与贡献数）。 */
export function agentUIRegistrations(): { packageId: string; tier: AgentUITier; renderers: number; providers: number }[] {
  return [...registrations.values()].map((r) => ({
    packageId: r.packageId,
    tier: r.tier,
    renderers: r.timelineRenderers.length,
    providers: r.composerProviders.length,
  }));
}

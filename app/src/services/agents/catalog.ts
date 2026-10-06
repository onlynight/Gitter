import { spawn } from "child_process";
import type { PackageStore } from "../extensions/store";
import type { HarnessContribution } from "../extensions/schema";
import type { AgentHarnessDTO, HarnessDescriptor, HarnessLaunchSpec } from "./types";
import { compileEventMap, type CompiledEventMap } from "./events";
/**
 * AgentCatalog——PackageStore 的 harness kind 消费者（agent-harness-codex.md v2.0 §三）。
 * 职责：枚举活跃包的 harnesses 段 → descriptor；detect 探测（命令 --version + versionPattern 门，
 * 结果带 TTL 缓存）；LaunchSpec 编译（when 表达式/占位符校验，编译错误进 DTO 的 error 字段）。
 */

const PLACEHOLDER_RE = /\{([a-zA-Z]+)\}/g;
/** LaunchSpec 模板允许的占位符（渲染期变量集，多即抛错——编译期拦截拼错） */
const KNOWN_PLACEHOLDERS = new Set(["worktree", "taskId", "externalSessionId", "sandbox"]);
const DETECT_TTL_MS = 60_000;

function collectPlaceholders(spec: HarnessContribution): string[] {
  const out = new Set<string>();
  const scan = (args: string[]) => {
    for (const a of args) {
      for (const m of a.matchAll(PLACEHOLDER_RE)) out.add(m[1]);
    }
  };
  scan(spec.spawn.args);
  if (spec.resume) scan(spec.resume.args);
  return [...out];
}

export interface HarnessCompileResult {
  spec: HarnessLaunchSpec | null;
  error: string | null;
}

/** 编译单个 harness 贡献 → LaunchSpec；校验事件表达式与占位符，失败返回 error（不抛）。 */
export function compileHarness(packageId: string, packageName: string, h: HarnessContribution): HarnessCompileResult {
  try {
    let eventMap: CompiledEventMap | null = null;
    if (h.events) {
      // 编译期把 when 表达式错误暴露出来（拒用该 harness 而非运行中崩）
      eventMap = compileEventMap(h.events);
    }
    const unknown = collectPlaceholders(h).filter((p) => !KNOWN_PLACEHOLDERS.has(p));
    if (unknown.length > 0) {
      return { spec: null, error: `模板占位符不在允许集 {worktree, taskId, externalSessionId, sandbox}：{${unknown.join(", {")}` };
    }
    const descriptor: HarnessDescriptor = {
      fullId: `${packageId}/${h.id}`,
      packageId,
      harnessId: h.id,
      displayName: packageName === h.id ? packageName : `${packageName} · ${h.id}`,
      transport: h.transport,
      fallback: h.fallback,
      capabilities: [...h.capabilities],
      submissionMode: h.submissionMode,
      identity: { assistedBy: h.identity.assistedBy },
      versionPattern: h.detect.versionPattern,
    };
    return {
      spec: {
        fullId: descriptor.fullId,
        packageId,
        harnessId: h.id,
        displayName: descriptor.displayName,
        descriptor,
        spawn: h.spawn,
        resume: h.resume,
        stopMode: h.stop.mode,
        hostServices: [...h.hostServices],
        permissions: h.permissions,
        promptTemplates: h.promptTemplates,
        eventMap,
      },
      error: null,
    };
  } catch (e) {
    return { spec: null, error: `harness 编译失败：${(e as Error).message}` };
  }
}

/** 枚举全部活跃 harness（含编译错误项——设置页/任务卡要能看到不可用原因）。 */
export function listHarnesses(store: PackageStore): { entries: AgentHarnessDTO[]; specs: Map<string, HarnessLaunchSpec> } {
  const entries: AgentHarnessDTO[] = [];
  const specs = new Map<string, HarnessLaunchSpec>();
  for (const p of store.list()) {
    if (p.state !== "active" || !p.kindStates.harness) continue;
    const rec = store.find(p.id);
    if (!rec) continue;
    for (const h of rec.manifest.contributes.harnesses) {
      const fullId = `${p.id}/${h.id}`;
      const { spec, error } = compileHarness(p.id, p.name, h);
      if (spec) specs.set(fullId, spec);
      entries.push({
        fullId,
        packageId: p.id,
        packageName: p.name,
        harnessId: h.id,
        displayName: spec?.descriptor.displayName ?? (p.name === h.id ? p.name : `${p.name} · ${h.id}`),
        transport: h.transport,
        fallback: h.fallback,
        capabilities: [...h.capabilities],
        submissionMode: h.submissionMode,
        identity: { assistedBy: h.identity.assistedBy },
        detect: detectSyncCache.get(fullId) ?? { available: false, version: null, reason: null },
        error,
      });
    }
  }
  return { entries, specs };
}

// ---- detect：命令探测 + versionPattern 门（结果缓存 60s）----

const detectSyncCache = new Map<string, { available: boolean; version: string | null; reason: string | null; at: number }>();

export function clearDetectCache(): void {
  detectSyncCache.clear();
}

function detectOnce(h: HarnessContribution): Promise<{ available: boolean; version: string | null; reason: string | null }> {
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const done = (r: { available: boolean; version: string | null; reason: string | null }) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    let child;
    try {
      child = spawn(h.detect.command, h.detect.args, { windowsHide: true, shell: false });
    } catch (e) {
      done({ available: false, version: null, reason: `探测命令启动失败：${(e as Error).message}` });
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      done({ available: false, version: null, reason: "探测命令超时（5s）" });
    }, 5000);
    child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      done({ available: false, version: null, reason: `未找到命令 '${h.detect.command}'（${e.message}）` });
    });
    child.on("close", () => {
      clearTimeout(timer);
      const text = out.trim();
      if (h.detect.versionPattern) {
        let re: RegExp;
        try {
          re = new RegExp(h.detect.versionPattern);
        } catch (e) {
          done({ available: false, version: null, reason: `versionPattern 非法：${(e as Error).message}` });
          return;
        }
        const m = re.exec(text);
        if (!m) {
          done({ available: false, version: null, reason: `版本不匹配（期望 /${h.detect.versionPattern}/，实际 "${text.slice(0, 80)}"）` });
          return;
        }
        done({ available: true, version: m[0], reason: null });
        return;
      }
      done({ available: text.length > 0, version: text.split(/\r?\n/)[0] ?? null, reason: text.length > 0 ? null : "命令无输出" });
    });
  });
}

export async function detectHarness(h: HarnessContribution, fullId: string) {
  const cached = detectSyncCache.get(fullId);
  if (cached && Date.now() - cached.at < DETECT_TTL_MS) {
    return { available: cached.available, version: cached.version, reason: cached.reason };
  }
  const r = await detectOnce(h);
  detectSyncCache.set(fullId, { ...r, at: Date.now() });
  return r;
}

/** 供 agents.list 使用：带缓存的批量探测（并发，单命令 5s 上限）。 */
export async function detectAll(store: PackageStore): Promise<Map<string, HarnessLaunchSpec>> {
  const jobs: Promise<void>[] = [];
  const specs = new Map<string, HarnessLaunchSpec>();
  for (const p of store.list()) {
    if (p.state !== "active" || !p.kindStates.harness) continue;
    const rec = store.find(p.id);
    if (!rec) continue;
    for (const h of rec.manifest.contributes.harnesses) {
      const fullId = `${p.id}/${h.id}`;
      const { spec, error } = compileHarness(p.id, p.name, h);
      if (spec) specs.set(fullId, spec);
      if (spec && !detectSyncCache.has(fullId)) {
        jobs.push(
          detectHarness(h, fullId).then(() => undefined),
        );
      }
    }
  }
  await Promise.all(jobs);
  return specs;
}

/** 渲染模板参数（{worktree} 等）；占位符缺失 = 调用方 bug，直接抛。 */
export function renderArgs(args: string[], vars: Record<string, string>): string[] {
  return args.map((a) =>
    a.replace(PLACEHOLDER_RE, (raw, name: string) => {
      const v = vars[name];
      if (v === undefined) throw new Error(`模板占位符 {${name}} 缺少运行时值`);
      return v;
    }),
  );
}

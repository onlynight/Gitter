/**
 * Agent 运营设置区（M1.1/M1.3/M3.1 harness-mainline-roadmap.md）：
 * - SubscriptionModelsCard：订阅 OAuth 档案（一键建档 / 登录 / 登出 / 状态 / 单价）；
 * - UsageSection：用量统计（按天 / 按模型 / 按任务 + 费用估算，纯读取聚合）；
 * - AboutUpdateSection：更新检查（可配 manifest URL，semver 比较，不做静默自更新）。
 */
import { useCallback, useEffect, useState } from "react";
import { onEvent } from "../bridge/client";
import { call } from "../bridge/client";
import { pageSdk } from "../pageSdk";
import type { ModelProfileDTO, UsageReport } from "../bridge/types";

function fmtTok(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}
function fmtCost(n: number | null): string {
  return n === null ? "—" : "$" + n.toFixed(n < 10 ? 4 : 2);
}

// ---------------- 订阅 OAuth ----------------

export function SubscriptionModelsCard(props: { onChanged?: () => void }) {
  const [profiles, setProfiles] = useState<ModelProfileDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pricing, setPricing] = useState<Record<string, { inM: string; outM: string }>>({});

  const reload = useCallback(() => {
    void call<ModelProfileDTO[]>("models.list").then(setProfiles).catch(() => {});
  }, []);
  useEffect(reload, [reload]);

  const oauthProfiles = profiles.filter((p) => p.authKind === "oauth" && p.source === "user");

  const createPreset = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await call<{ id: string }>("models.createSubscriptionPreset", {});
      reload();
      props.onChanged?.();
      setMsg("已创建 Claude 订阅档案——点击「订阅登录」完成 OAuth 授权后即可使用");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const login = async (id: string) => {
    setBusy(true);
    setMsg("已打开浏览器等待授权…（5 分钟内完成）");
    try {
      const r = await call<{ expiresAt: number }>("models.oauthLogin", { id });
      setMsg(`登录成功，令牌有效期至 ${new Date(r.expiresAt).toLocaleString()}`);
      reload();
    } catch (e) {
      setMsg(`登录失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const logout = async (id: string) => {
    await call("models.oauthLogout", { id }).catch(() => {});
    setMsg("已登出");
    reload();
  };

  const savePricing = async (p: ModelProfileDTO) => {
    const gid = p.groupId;
    const entry = pricing[gid] ?? { inM: "", outM: "" };
    setBusy(true);
    try {
      await call("models.save", {
        profile: {
          id: gid,
          name: p.name,
          kind: p.kind,
          baseURL: p.baseURL,
          modelId: p.modelId,
          authKind: "oauth",
          oauth: undefined,
          pricing: {
            inputPerM: entry.inM.trim() === "" ? undefined : Number(entry.inM) || 0,
            outputPerM: entry.outM.trim() === "" ? undefined : Number(entry.outM) || 0,
          },
        },
      });
      setMsg("单价已保存");
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", margin: "4px 0 6px" }}>
        <span style={{ fontWeight: 600, fontSize: 12, color: "var(--c-text2)" }}>订阅登录（OAuth）</span>
        <button className="tool-btn" disabled={busy} onClick={() => void createPreset()}>一键创建 Claude 订阅档案</button>
        <span className="hint">订阅走 claude.ai OAuth（PKCE），令牌 safeStorage 落盘；API 密钥模式不受影响</span>
      </div>
      {oauthProfiles.map((p) => {
        const loggedIn = (p.oauthExpiresAt ?? 0) > Date.now() || p.oauthExpiresAt === null && p.configured;
        const pr = pricing[p.groupId] ?? { inM: String(p.pricing?.inputPerM ?? ""), outM: String(p.pricing?.outputPerM ?? "") };
        return (
          <div key={p.id} className="settings-row" style={{ flexWrap: "wrap", gap: 6 }}>
            <label style={{ minWidth: 160 }}>{p.name}</label>
            <span className="hint">
              {loggedIn ? `已登录${p.oauthExpiresAt ? `（至 ${new Date(p.oauthExpiresAt).toLocaleString()}）` : ""}` : "未登录"}
              {" · "}{p.modelId}
            </span>
            {loggedIn ? (
              <button className="tool-btn" disabled={busy} onClick={() => void logout(p.id)}>登出</button>
            ) : (
              <button className="tool-btn primary" disabled={busy} onClick={() => void login(p.id)}>订阅登录</button>
            )}
            <input className="input" style={{ width: 90 }} placeholder="输入 $/Mtok" title="输入单价（每百万 token）" value={pr.inM}
              onChange={(e) => setPricing((m) => ({ ...m, [p.groupId]: { ...pr, inM: e.target.value } }))} />
            <input className="input" style={{ width: 90 }} placeholder="输出 $/Mtok" title="输出单价（每百万 token）" value={pr.outM}
              onChange={(e) => setPricing((m) => ({ ...m, [p.groupId]: { ...pr, outM: e.target.value } }))} />
            <button className="tool-btn" disabled={busy} onClick={() => void savePricing(p)}>存单价</button>
          </div>
        );
      })}
      {msg && <div className="hint" style={{ color: "var(--c-text2)" }}>{msg}</div>}
    </div>
  );
}

// ---------------- 用量统计 ----------------

export function UsageSection() {
  const [rep, setRep] = useState<UsageReport | null>(null);
  const [allProjects, setAllProjects] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback((all: boolean) => {
    void call<UsageReport>("agent.usage.report", { allProjects: all })
      .then((r) => { setRep(r); setErr(null); })
      .catch((e) => setErr((e as Error).message));
  }, []);
  useEffect(() => reload(allProjects), [reload, allProjects]);

  if (err) return <div className="hint" style={{ color: "var(--c-red)" }}>{err}</div>;
  if (!rep) return <div className="hint">加载中…</div>;
  const t0 = rep.totals;
  return (
    <div>
      <div className="settings-row">
        <label>汇总（turn 数 {t0.turns}）</label>
        <span className="hint">
          输入 {fmtTok(t0.inputTokens)} tok · 输出 {fmtTok(t0.outputTokens)} tok · 缓存命中 {fmtTok(t0.cacheReadTokens)} tok · 估算费用 {fmtCost(t0.cost)}
        </span>
        <span style={{ flex: 1 }} />
        <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12 }}>
          <input type="checkbox" checked={allProjects} onChange={(e) => setAllProjects(e.target.checked)} />
          含全部项目
        </label>
        <button className="tool-btn" onClick={() => reload(allProjects)}>刷新</button>
      </div>
      {rep.emptyRepos.length > 0 && (
        <div className="hint">{rep.emptyRepos.length} 个仓库暂无任务账本（未跑过 agent 任务）</div>
      )}
      {/* 详细视图已迁至独立用量页（usage 槽，KPI/每日趋势/模型分布/任务明细）；
          此处仅保留汇总与跳转，避免设置页承载长表。 */}
      <div className="settings-row" style={{ marginTop: 6 }}>
        <span className="hint" style={{ fontSize: 11 }}>
          {rep.byTask.length} 个任务 · {rep.byModel.length} 个模型档案
          {rep.cacheBreaks > 0 ? ` · ${rep.cacheBreaks} 次缓存断点` : ""}
        </span>
        <span style={{ flex: 1 }} />
        <button className="tool-btn" onClick={() => pageSdk.navigate("usage")}>在用量页查看 →</button>
      </div>
      <div className="hint" style={{ marginTop: 4 }}>费用 = 档案单价（订阅卡内配置，$/Mtok）× token；未配置单价的档案显示「—」而非 0。</div>
    </div>
  );
}

// ---------------- 更新检查（M3.1 自动更新：检查 → 下载 → 重启安装） ----------------

interface UpdateState {
  phase: "idle" | "checking" | "available" | "none" | "downloading" | "downloaded" | "error";
  current: string;
  latest: string | null;
  progress: number | null;
  error: string | null;
  feedConfigured: boolean;
  devFallback: boolean;
  infoUrl: string | null;
}

export function AboutUpdateSection() {
  const [url, setUrl] = useState<string>("");
  const [st, setSt] = useState<UpdateState | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void call<{ updateCheckUrl?: string | null }>("settings.get").then((s) => {
      setUrl(s?.updateCheckUrl ?? "");
      setLoaded(true);
    }).catch(() => setLoaded(true));
    void call<UpdateState>("app.update.state").then(setSt).catch(() => {});
    // 下载进度/终态经 evt 通道推送
    const off = onEvent("app.update.event", (params) => setSt(params as unknown as UpdateState));
    return off;
  }, []);

  const saveFeed = (v: string) => {
    setUrl(v);
    void call("settings.set", { patch: { updateCheckUrl: v.trim() || null } }).catch(() => {});
  };

  const check = async () => {
    setBusy(true);
    try {
      await call("settings.set", { patch: { updateCheckUrl: url.trim() || null } });
      const r = await call<UpdateState & { ok?: boolean }>("app.update.check", {});
      setSt(r as UpdateState);
    } catch (e) {
      setSt((prev) => prev && { ...prev, phase: "error", error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setBusy(true);
    try {
      setSt(await call<UpdateState>("app.update.download", {}));
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    await call("app.update.install", {}).catch(() => {});
  };

  if (!loaded) return null;
  const phase = st?.phase ?? "idle";
  return (
    <div>
      <div className="settings-row">
        <label>更新源</label>
        <input className="input" style={{ width: 340 }}
          placeholder="GitHub 仓库（github.com/owner/repo）或 latest.yml 所在目录 URL"
          value={url} onChange={(e) => saveFeed(e.target.value)} />
        <button className="tool-btn" disabled={busy || !url.trim()} onClick={() => void check()}>
          {phase === "checking" || (busy && phase !== "downloading") ? "检查中…" : "检查更新"}
        </button>
      </div>
      {st && (
        <div className="settings-row">
          <label />
          <span className="hint">
            当前 v{st.current}
            {st.devFallback ? " · dev 模式仅检查（打包版才可下载安装）" : ""}
            {phase === "available" && st.latest ? ` · 发现新版本 v${st.latest}` : ""}
            {phase === "none" ? " · 已是最新" : ""}
            {phase === "downloading" ? ` · 下载中 ${Math.round(st.progress ?? 0)}%` : ""}
            {phase === "downloaded" ? ` · v${st.latest ?? ""} 已下载，退出时将自动安装` : ""}
            {phase === "error" && st.error ? ` · ${st.error}` : ""}
          </span>
          <span style={{ flex: 1 }} />
          {phase === "available" && !st.devFallback && (
            <button className="tool-btn primary" disabled={busy} onClick={() => void download()}>下载更新</button>
          )}
          {phase === "available" && st.devFallback && st.infoUrl && (
            <button className="tool-btn" onClick={() => void call("shell.openExternal", { url: st.infoUrl })}>打开发布页</button>
          )}
          {phase === "downloading" && (
            <div className="upd-progress"><div className="upd-progress-bar" style={{ width: `${st.progress ?? 0}%` }} /></div>
          )}
          {phase === "downloaded" && (
            <button className="tool-btn primary" onClick={() => void install()}>重启并安装</button>
          )}
        </div>
      )}
      <div className="settings-row">
        <label />
        <span className="hint">不做后台静默下载：检查与下载均由你触发；已下载的更新在退出应用时自动安装。安装包经 latest.yml 的 SHA512 校验（无签名通道）。</span>
      </div>
    </div>
  );
}

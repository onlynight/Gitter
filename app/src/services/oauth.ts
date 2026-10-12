import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import type { OAuthProfileConfig } from "../shared/types";

/**
 * 订阅 OAuth（M1.1 harness-mainline-roadmap.md）：PKCE 授权码 + 本地回环回调。
 * 令牌持久化 <userData>/oauth.json——safeStorage 密文（加密器注入，无头冒烟可换明文桩）；
 * 端点配置来自模型档案（oauth 字段），内置预设一键回填，不锁死官方端点。
 * 纯函数（PKCE/URL 组装/令牌交换）与 IO 分离，冒烟可测；登录全程不落明文。
 */

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** epoch ms */
  expiresAt: number;
  account?: string | null;
}

/** 加密器抽象：Electron 主进程传 safeStorage 适配；冒烟传明文桩。 */
export interface OAuthCrypt {
  encrypt(plain: string): string | null;
  decrypt(blob: string): string | null;
}

interface OAuthStoreFile {
  version: 1;
  tokens: Record<string, { blob: string }>;
}

export class OAuthManager {
  private readonly filePath: string;
  private readonly crypt: OAuthCrypt;
  private data: OAuthStoreFile = { version: 1, tokens: {} };

  constructor(userDataDir: string, crypt: OAuthCrypt) {
    this.filePath = path.join(userDataDir, "oauth.json");
    this.crypt = crypt;
    this.load();
  }

  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<OAuthStoreFile>;
      if (raw.tokens && typeof raw.tokens === "object") this.data = { version: 1, tokens: raw.tokens };
    } catch {
      /* 不存在/损坏 → 空表 */
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
    } catch {
      /* 落盘失败：登录态留在内存，下次保存再试 */
    }
  }

  private readTokens(profileId: string): OAuthTokenSet | null {
    const rec = this.data.tokens[profileId];
    if (!rec?.blob) return null;
    try {
      const plain = this.crypt.decrypt(rec.blob);
      if (!plain) return null;
      const t = JSON.parse(plain) as OAuthTokenSet;
      return t?.accessToken ? t : null;
    } catch {
      return null;
    }
  }

  private writeTokens(profileId: string, t: OAuthTokenSet): void {
    const blob = this.crypt.encrypt(JSON.stringify(t));
    if (!blob) return; // 加密不可用（如无 keyring）：不落盘明文，登录态仅本轮内存有效
    this.data.tokens[profileId] = { blob };
    this.save();
  }

  status(profileId: string): { loggedIn: boolean; expiresAt: number | null } {
    const t = this.readTokens(profileId);
    return { loggedIn: !!t, expiresAt: t?.expiresAt ?? null };
  }

  logout(profileId: string): void {
    delete this.data.tokens[profileId];
    this.save();
  }

  /** 取可用 access token：未过期直接用；将过期（<60s）用 refresh_token 续；无令牌抛错。 */
  async ensureToken(profileId: string, cfg: OAuthProfileConfig): Promise<string> {
    const t = this.readTokens(profileId);
    if (!t) throw new Error("该档案使用订阅登录，但尚未登录——请在 设置 → 模型档案 完成订阅登录");
    if (t.expiresAt - Date.now() > 60_000) return t.accessToken;
    if (!t.refreshToken) throw new Error("订阅登录已过期且无刷新令牌——请重新登录");
    const next = await tokenRequest(cfg, {
      grant_type: "refresh_token",
      refresh_token: t.refreshToken,
      client_id: cfg.clientId,
    });
    const merged: OAuthTokenSet = {
      accessToken: next.access_token,
      refreshToken: next.refresh_token ?? t.refreshToken,
      expiresAt: Date.now() + (Number(next.expires_in) || 3600) * 1000,
      account: t.account ?? null,
    };
    this.writeTokens(profileId, merged);
    return merged.accessToken;
  }

  /**
   * 发起登录：起本地回环服务（随机端口）→ 返回授权 URL 与完成 Promise。
   * 打开浏览器由调用方负责（GUI 用 shell.openExternal；headless 打印 URL 手动开）。
   * 5 分钟未完成自动关服并拒绝。
   */
  async beginLogin(profileId: string, cfg: OAuthProfileConfig): Promise<{ authorizeUrl: string; done: Promise<OAuthTokenSet> }> {
    const verifier = pkceVerifier();
    const challenge = pkceChallenge(verifier);
    const state = crypto.randomBytes(16).toString("base64url");
    const server = http.createServer();
    const port = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
    });
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const authorizeUrl = buildAuthorizeUrl(cfg, redirectUri, state, challenge);
    const done = (async (): Promise<OAuthTokenSet> => {
      const code = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          server.close();
          reject(new Error("OAuth 登录超时（5 分钟未完成授权）"));
        }, 5 * 60_000);
        server.on("request", (req, res) => {
          const url = new URL(req.url ?? "/", "http://127.0.0.1");
          if (url.pathname !== "/callback") {
            res.writeHead(404).end();
            return;
          }
          const err = url.searchParams.get("error");
          const gotState = url.searchParams.get("state");
          const gotCode = url.searchParams.get("code");
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(err
            ? `<title>Gitter 登录失败</title><p>登录失败：${escapeHtml(err)}</p>`
            : "<title>Gitter</title><p>登录成功，请返回 Gitter 继续使用。</p>");
          clearTimeout(timer);
          server.close();
          if (err) reject(new Error(`授权方拒绝：${err}`));
          else if (gotState !== state) reject(new Error("OAuth state 不匹配（疑似 CSRF），已中止"));
          else if (gotCode) resolve(gotCode);
          else reject(new Error("回调缺少授权码"));
        });
      });
      const tok = await tokenRequest(cfg, {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: cfg.clientId,
        code_verifier: verifier,
      });
      const t: OAuthTokenSet = {
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token ?? null,
        expiresAt: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
        account: profileId,
      };
      this.writeTokens(profileId, t);
      return t;
    })();
    return { authorizeUrl, done };
  }

  /** 测试接缝：注入既定令牌（冒烟用，绕过真实网络）。 */
  putTokensForTest(profileId: string, t: OAuthTokenSet): void {
    this.writeTokens(profileId, t);
  }
}

// ---- 纯函数：PKCE / 授权 URL / 令牌交换 ----

export function pkceVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function pkceChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export function buildAuthorizeUrl(cfg: OAuthProfileConfig, redirectUri: string, state: string, challenge: string): string {
  const u = new URL(cfg.authorizeUrl);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", cfg.scopes);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string | null;
  expires_in?: number | string;
}

async function tokenRequest(cfg: OAuthProfileConfig, form: Record<string, string>): Promise<TokenResponse> {
  const body = new URLSearchParams(form);
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  for (const [k, v] of Object.entries(cfg.extraHeaders ?? {})) headers[k] = v;
  const res = await fetch(cfg.tokenUrl, { method: "POST", headers, body: body.toString() });
  const text = await res.text();
  let j: TokenResponse | undefined;
  try {
    j = JSON.parse(text) as TokenResponse;
  } catch {
    /* 非 JSON 错误体 */
  }
  if (!res.ok || !j?.access_token) {
    throw new Error(`OAuth 令牌交换失败（HTTP ${res.status}）：${text.slice(0, 200)}`);
  }
  return j;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

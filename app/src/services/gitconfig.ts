import { git, tryGit, GitError } from "./gitexec";
import { classifyPushError } from "./gitstatus";

// git 配置读写（设置页"Git 配置"区 + 推送错误自助修复的后端）。
// 层级：repo = .git/config（--local），global = 用户级（--global）。
// 读取用默认解析（仓库值覆盖全局），写入按调用方指定层级。

export type ConfigScope = "repo" | "global";

/** 读取某层级的全部配置（key 统一小写；同名取最后一条，与 git 解析一致）。 */
export async function listConfig(workDir: string, scope: ConfigScope): Promise<Record<string, string>> {
  const r = await tryGit(workDir, ["config", "--list", scope === "repo" ? "--local" : "--global"]);
  const map: Record<string, string> = {};
  for (const line of r.stdout.split(/\r?\n/)) {
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    map[line.slice(0, eq).toLowerCase()] = line.slice(eq + 1);
  }
  return map;
}

/** 读取键的有效值（仓库 → 全局 → 未设置）。 */
export async function effectiveConfig(workDir: string, key: string): Promise<string | null> {
  const r = await tryGit(workDir, ["config", key]);
  const v = r.stdout.trim();
  return r.code === 0 && v.length > 0 ? v : null;
}

/** 写配置；value 为 null = unset（键不存在时 git 返回码 5，容忍）。 */
export async function setConfig(workDir: string, key: string, value: string | null, scope: ConfigScope): Promise<void> {
  const flag = scope === "repo" ? "--local" : "--global";
  const args =
    value === null || value === ""
      ? ["config", flag, "--unset", key]
      : ["config", flag, key, value];
  const r = await tryGit(workDir, args);
  if (r.code !== 0 && r.code !== 5) throw new GitError(args, r);
}

// ---- 远程仓库 ----

export interface RemoteInfo {
  name: string;
  url: string;
}

export async function listRemotes(workDir: string): Promise<RemoteInfo[]> {
  const r = await tryGit(workDir, ["remote", "-v"]);
  const map = new Map<string, string>();
  for (const line of r.stdout.split(/\r?\n/)) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    if (tab <= 0) continue;
    const name = line.slice(0, tab);
    const rest = line.slice(tab + 1);
    // "url (fetch)" / "url (push)"：fetch 行为准，push 行跳过
    if (!rest.endsWith("(fetch)")) continue;
    map.set(name, rest.slice(0, -"(fetch)".length).trim());
  }
  return [...map.entries()].map(([name, url]) => ({ name, url }));
}

export async function addRemote(workDir: string, name: string, url: string): Promise<void> {
  await git(workDir, ["remote", "add", name, url]);
}

export async function removeRemote(workDir: string, name: string): Promise<void> {
  await git(workDir, ["remote", "remove", name]);
}

// ---- 推送自助修复 ----

export interface SetUpstreamResult {
  pushed: boolean;
  remote: string;
  branch: string;
  errorKind: string | null;
}

/**
 * 一键设置上游并推送（推送报 noUpstream 时的修复动作）：
 * git push --set-upstream <remote> <当前分支>。无远程仓库时抛 NO_REMOTE
 * （渲染层引导去设置页添加），无当前分支（游离 HEAD）抛 NO_BRANCH。
 */
export async function pushSetUpstream(workDir: string): Promise<SetUpstreamResult> {
  const branch = (await tryGit(workDir, ["branch", "--show-current"])).stdout.trim();
  if (!branch) throw new GitError(["push", "--set-upstream"], { code: -1, stdout: "", stderr: "NO_BRANCH" });

  const remotes = await listRemotes(workDir);
  if (remotes.length === 0) throw new GitError(["push", "--set-upstream"], { code: -1, stdout: "", stderr: "NO_REMOTE" });
  const remote = remotes.some((r) => r.name === "origin") ? "origin" : remotes[0].name;

  const r = await tryGit(workDir, ["push", "--set-upstream", remote, branch]);
  if (r.code !== 0) {
    return { pushed: false, remote, branch, errorKind: classifyPushError(r.stderr + r.stdout) };
  }
  return { pushed: true, remote, branch, errorKind: null };
}

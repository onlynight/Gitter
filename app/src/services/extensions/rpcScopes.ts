/**
 * RPC 权限域分级表（ui-pluginization-plan.md U2）：
 * 外部页面插件经 window.GITTER_UI.call 调用宿主桥时，bridge 入口按本表校验
 * 页面声明（contributes.pages[].permissions）是否覆盖所需域；未授权拒绝。
 *
 * 信任模型（文档 §16.6 U2 如实标注）：渲染层 in-process 下，恶意代码物理上可
 * 直连 gitter.invoke 绕过本表——执行强度只对诚实插件有效（advisory），
 * 最终防线是 allowCodePlugins 审核渠道门 + 主进程侧人审门/安全网（天然不受影响）。
 * 未收录方法默认 extensions.admin（默认拒绝外部调用，防新增 RPC 漏分级——
 * smoke-u2 的完整性断言会强制新 RPC 必须显式分级）。
 */

export type RpcScope =
  | "open" // 无敏感读（UI 数据/清单/状态）
  | "git.read" // git/仓库只读
  | "git.write" // git 写操作（stage/commit/分支变更——主进程侧人审门/安全网仍生效）
  | "settings.write" // 持久化写（settings/gitconfig/rememberCommand）
  | "agent.run" // 驱动 agent 任务/循环
  | "agent.config" // agent 授权回执/历史读取
  | "extensions.admin" // 扩展安装/卸载/启停等管理操作
  | "terminal" // pty 会话操作
  | "ai.invoke" // 消耗 AI 额度
  | "approval" // 人审回执（可替人类放行 MCP 写操作——高危）
  | "window"; // 窗口/壳层操作

export const SCOPE_NAMES: RpcScope[] = [
  "open", "git.read", "git.write", "settings.write",
  "agent.run", "agent.config", "extensions.admin",
  "terminal", "ai.invoke", "approval", "window",
];

export const RPC_SCOPES: Record<string, RpcScope> = {
  // ---- open：无敏感读 ----
  "ui.panels": "open", "ui.views": "open", "ui.statusItems": "open",
  "ui.emptyHints": "open", "ui.commitBlocks": "open", "diff.notes": "open",
  "themes.list": "open", "themes.state": "open", "i18n.strings": "open",
  "settings.get": "open", "settings.schema": "open",
  "skills.list": "open", "tools.list": "open", "commands.list": "open", "menus.list": "open",
  "agent.loops": "open", "agent.taskTypes.list": "open", "agents.list": "open",
  "extensions.list": "open", "host.status": "open",
  "repo.state": "open", "mcp.state": "open", "mcp.setPipeName": "open",
  "ai.state": "open", "models.list": "open",
  "terminal.profiles": "open", "terminal.list": "open",
  "tasks.list": "open", "projects.list": "open",
  "app.gitVersion": "open", "agent.task.history": "open", "api.info": "open",
  "agent.tasks": "git.read", "highlight.file": "open", "extensions.pages": "open",
  "agent.context.stats": "open",
  "agent.task.shells": "open", "agent.seams.audit": "open",
  "remote.list": "git.read",
  // agent 改动预览读面（agent-harness-v4.md F6）
  "repo.files": "git.read", "agent.task.files": "git.read",
  "agent.task.diff": "git.read", "agent.task.diffText": "git.read", "agent.task.checkpoints": "git.read",
  // D6/D9：导出（弹系统保存框）与文件只读预览——均为会话级读取面
  "agent.task.export": "agent.config", "agent.task.previewFile": "git.read",
  "agent.previewImage": "git.read",

  // ---- git.read ----
  "log.query": "git.read", "log.branches": "git.read", "log.detail": "git.read", "log.fileDiff": "git.read",
  "changes.state": "git.read", "changes.diffFile": "git.read", "changes.feedback": "git.read",
  "changes.safetyScan": "git.read", "branches.state": "git.read",
  "gitconfig.list": "git.read", "file.preview": "git.read",

  // ---- git.write（主进程侧人审门/安全网天然继续生效） ----
  "changes.stage": "git.write", "changes.unstage": "git.write",
  "changes.stageHunks": "git.write", "changes.unstageHunks": "git.write",
  "changes.commit": "git.write", "changes.push": "git.write", "changes.pull": "git.write",
  "changes.fetch": "git.write", "changes.pushSetUpstream": "git.write",
  "changes.clearFeedback": "git.write",
  "branches.checkout": "git.write", "branches.create": "git.write", "branches.delete": "git.write",
  "branches.deletePreview": "git.write", "branches.ff": "git.write", "branches.merge": "git.write",
  "branches.pull": "git.write", "branches.push": "git.write", "branches.rebase": "git.write",
  "branches.rename": "git.write",
  "log.reset": "git.write", "log.squash": "git.write",
  "tasks.create": "git.write", "tasks.remove": "git.write",
  "gitconfig.set": "git.write",
  "remote.add": "git.write", "remote.remove": "git.write",

  // ---- settings.write ----
  "settings.set": "settings.write", "settings.setAiKey": "settings.write",
  "settings.rememberCommand": "settings.write",

  // ---- agent.run ----
  "agent.task.create": "agent.run", "agent.task.resume": "agent.run", "agent.task.stop": "agent.run",
  "agent.task.feedback": "agent.run", "agent.task.setModel": "agent.run",
  "agent.task.fork": "agent.run", "agent.task.archive": "agent.run", "agent.task.delete": "agent.run",
  "agent.loop.run": "agent.run", "review.repair": "agent.run",
  "agent.task.queue": "agent.run", "agent.task.setMode": "agent.run",
  "agent.task.compact": "agent.run", "agent.task.clear": "agent.run",

  // ---- agent.config ----
  "agent.perm.reply": "agent.config",

  // ---- git.write（任务 worktree 恢复；host 侧 agent.restore 仅作用任务 worktree） ----
  "agent.task.restore": "git.write",

  // ---- extensions.admin ----
  "extensions.importGpk": "extensions.admin", "extensions.installFromCatalog": "extensions.admin",
  "extensions.setEnabled": "extensions.admin", "extensions.setKindEnabled": "extensions.admin",
  "extensions.setConfig": "extensions.admin", "extensions.uninstall": "extensions.admin",

  // ---- terminal ----
  "terminal.ensure": "terminal", "terminal.write": "terminal", "terminal.resize": "terminal", "terminal.close": "terminal",

  // ---- ai.invoke ----
  "ai.generateCommitMessage": "ai.invoke", "ai.explain": "ai.invoke",
  "models.test": "ai.invoke", "models.save": "ai.invoke", "models.delete": "ai.invoke",
  "models.setDefault": "ai.invoke", "models.setFast": "ai.invoke", "models.setKey": "ai.invoke",

  // ---- approval（可替人类放行 MCP 写操作——高危域） ----
  "mcp.approve": "approval",

  // ---- window ----
  "app.newWindow": "window",
  "shell.openPath": "window", "shell.reveal": "window", "shell.openExternal": "window",
  "dialog.pickFile": "window",
  "projects.pickFolder": "window", "projects.add": "window", "projects.open": "window", "projects.remove": "window",
  "repo.open": "window", "repo.close": "window",
  "commands.exec": "window",
};

/** 外部页缺省声明（manifest 未写 permissions 时）：open + git.read（保守可用）。 */
export const DEFAULT_PAGE_SCOPES: RpcScope[] = ["open", "git.read"];

/** 查询方法所需域；未收录方法默认 extensions.admin（默认拒绝外部调用）。 */
export function requiredScope(method: string): RpcScope {
  return RPC_SCOPES[method] ?? "extensions.admin";
}

/** 页面声明是否覆盖所需域（open 恒放行；页面声明 "webview" 等非 RPC 域不参与判定）。 */
export function scopeGranted(required: RpcScope, declared: readonly string[]): boolean {
  if (required === "open") return true;
  return declared.includes(required);
}

/** bridge handle 入口的 __caller 身份（sdk.ts 注入；permissions 来自 manifest，非页面脚本自报）。 */
export interface CallerIdentity {
  packageId: string;
  permissions?: string[];
}

/** 调用方访问判定（R0/A1 权限闭环：纯函数化以便冒烟直测——声明缺失回退 DEFAULT_PAGE_SCOPES）。 */
export function checkCallerAccess(
  method: string,
  caller: CallerIdentity,
): { ok: true } | { ok: false; scope: RpcScope } {
  const scope = requiredScope(method);
  const declared = caller.permissions ?? DEFAULT_PAGE_SCOPES as string[];
  if (!scopeGranted(scope, declared)) return { ok: false, scope };
  return { ok: true };
}

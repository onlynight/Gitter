// dev-only 生成 web/dist/mock.html（视觉验证用：注入 mock 桥 + 真实文案 + 模拟数据）；勿提交
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

const lines = fs.readFileSync(path.join(root, "app/resources/Strings.tsv"), "utf8").split(/\r?\n/).filter((l) => l.trim());
const strings = {};
for (const line of lines) {
  const i = line.indexOf("\t");
  if (i <= 0) continue;
  const key = line.slice(0, i);
  const rest = line.slice(i + 1);
  const j = rest.indexOf("\t");
  strings[key] = j >= 0 ? rest.slice(j + 1) : rest;
}

const commits = [
  { sha: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0", shortSha: "a1b2c3d", subject: "feat: 分支页左右双栏", body: "", author: "wyndam", authorEmail: "w@x.co", authorDate: Math.floor(Date.now() / 1000) - 3600, committerDate: Math.floor(Date.now() / 1000) - 3600, parents: ["b0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9"], refs: [], assistedBy: [], sessionId: null, files: [] },
];

const reflogEntries = [
  { sha: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0", shortSha: "a1b2c3d", selector: "dev@{0}", subject: "commit: feat: 分支页左右双栏", timestamp: Math.floor(Date.now() / 1000) - 600 },
  { sha: "b0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9", shortSha: "b0a1b2c", selector: "dev@{1}", subject: "commit: fix: 合并对话框预选值", timestamp: Math.floor(Date.now() / 1000) - 86400 },
  { sha: "f752eca377e75056b8f8e5e32bb7b25b00cece3e", shortSha: "f752eca", selector: "dev@{2}", subject: "reset: moving to f752eca", timestamp: Math.floor(Date.now() / 1000) - 90000 },
];

const invokeBody = `
    const ok = (data) => ({ ok: true, data });
    const b = (name, sha, subject, isHead) => ({ name, shortSha: sha, subject, isHead: !!isHead, isRemote: false });
    const r = (name, sha, subject) => ({ name, shortSha: sha, subject, isHead: false, isRemote: true });
    const tg = (name, sha, subject) => ({ name, shortSha: sha, subject });
    const pkg = 'D:/Code/Gitter/app/resources/packages';
    const page = (pid, slot, title) => ({
      packageId: 'gitui.page.' + pid, id: 'ext.gitui.page.' + pid + '.' + pid, slot,
      title, entryAbs: pkg + '/gitui.page.' + pid + '/page.js', permissions: ['git.read', 'git.write', 'window'],
      styles: [], lazy: true, isBuiltIn: true, icon: null, svg: null,
    });
    switch (method) {
      case 'settings.get': return ok({
        theme: 'system', themePackageId: null, language: 'zh-Hans',
        projects: [{ name: 'mock-repo', path: 'D:/mock/repo', lastOpened: Date.now() }],
        currentProjectPath: 'D:/mock/repo', externalEditor: null, diffMode: 'sideBySide',
        sidebarCollapsed: false, bashPath: null, terminalFontFamily: 'Consolas', terminalFontSize: 12,
        terminalFollowRepo: true, terminalShell: 'powershell', watchWorktree: true, autoFetch: false,
        autoFetchIntervalMinutes: 5, recentCommands: [], aiProvider: 'off', aiEndpoint: null, aiModel: null,
        aiCliCommand: null, aiPrivacy: 'metadataOnly', aiAppendTrailer: true, aiApiKeyProtected: null,
        safetyNet: 'warn', mcpEnabled: false, logSplitterFraction: null, changesSplitterFraction: null,
        packages: {}, confirmedCommands: [], allowCodePlugins: false, externalMcpEnabled: false,
        agentsCheckpoint: true, agentsOnExit: 'keep', agentRules: [], agentsCompaction: 'auto',
        agentsCompactionPolicy: {}, agentsPostTurnHooks: false, agentsNotify: false, agentsMaxSubagents: 4,
        agentsExternalMcpTools: false, models: [], defaultModelId: null, fastModelId: null, modelUsage: {},
      });
      case 'settings.set': { params = params || {}; MOCK_SETTINGS = { ...MOCK_SETTINGS, ...(params.patch || {}) }; return ok(MOCK_SETTINGS); }
      case 'themes.state': return ok({ base: 'dark', activeId: 'gitui.theme.solid-dark', material: 'none', themeId: 'gitui.theme.solid-dark', tokens: { Base: '#0D0D0D', Panel: '#171717', Panel2: '#202020', Hover: '#272727', Selected: '#333333', Border: '#2B2B2B', BorderStrong: '#3E3E3E', Accent: '#EAEAEA', AccentHover: '#FFFFFF', AccentPressed: '#C9C9C9', AccentSoft: '#EAEAEA26', OnAccent: '#0D0D0D', Text: '#EAEAEA', Text2: '#A0A0A0', Text3: '#6E6E6E', Link: '#6BABF5', Green: '#3FB950', Red: '#F0655A', Amber: '#E3B341', ChipBlueBg: '#1D2733', ChipBlueFg: '#8DB8F5', ChipPurpleBg: '#241F33', ChipPurpleFg: '#B9A3EC' }, diff: {}, terminal: {}, syntax: {} });
      case 'i18n.strings': return ok({ lang: 'zh-Hans', strings: STRINGS_JSON });
      case 'repo.open': return ok({ workDir: 'D:/mock/repo', name: 'mock-repo' });
      case 'branches.state': return ok({
        workDir: 'D:/mock/repo', current: 'main',
        local: [b('main', 'a1b2c3d', 'feat: 分支页左右双栏', true), b('dev', 'e4f5a6b', 'fix: dev 提交'), b('feature/merge-ui', 'b7c8d9e', 'wip')],
        remote: [r('origin/main', 'a1b2c3d', 'feat'), r('origin/dev', 'e4f5a6b', 'fix')],
        tags: [tg('v1.0.0', '4d5e6f7', 'release 1.0.0')],
      });
      case 'tags.list': return ok(['v1.0.0']);
      case 'log.branches': return ok({ current: 'main', names: ['main', 'dev', 'feature/merge-ui'] });
      case 'log.query': return ok({ commits: COMMITS_JSON, hasMore: false, total: 1 });
      case 'log.detail': return ok({ sha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0', subject: 'feat', author: 'wyndam', authorEmail: 'w@x.co', authorDate: 1, committerDate: 1, parents: [], body: '', files: [], refs: [] });
      case 'reflog.list': return ok(REFLOG_JSON);
      case 'changes.state': return ok({ changes: [], staged: [], unversioned: [], conflicts: [] });
      case 'branches.deletePreview': return ok({ forceRequired: true, lostCount: 2, lostSamples: [{ shortSha: 'c9d0e1f', subject: 'chore' }] });
      case 'branches.checkoutRemote': return ok('main');
      case 'branches.deleteRemote': case 'branches.checkout': case 'branches.ff': case 'branches.merge': case 'branches.create': case 'branches.rebase': case 'branches.delete': case 'tags.delete': case 'tags.create': case 'log.reset': return ok({});
      case 'menus.list': case 'commands.list': case 'ui.views': case 'ui.panels': case 'ui.statusItems': return ok([]);
      case 'projects.list': return ok([{ name: 'mock-repo', path: 'D:/mock/repo', lastOpened: Date.now() }]);
      case 'extensions.pages': return ok([
        page('projects', 'projects', '项目'), page('log', 'log', '日志'), page('changes', 'changes', '更改'),
        page('branches', 'branches', '分支'), page('tasks', 'tasks', '任务'), page('bash', 'bash', '终端'), page('settings', 'settings', '设置')
      ]);
      default: return ok({});
    }`
  .replace("COMMITS_JSON", JSON.stringify(commits))
  .replace("REFLOG_JSON", JSON.stringify(reflogEntries));

const mockScript = `<script>
let MOCK_SETTINGS = null;
(function () {
  const origCreate = document.createElement.bind(document);
  document.createElement = function (tag, opts) {
    const el = origCreate(tag, opts);
    const rewrite = (u) => {
      if (typeof u === 'string' && u.startsWith('file:///D:/Code/Gitter/app/resources/packages/')) {
        return '/packages/' + u.slice('file:///D:/Code/Gitter/app/resources/packages/'.length);
      }
      return u;
    };
    if (tag === 'script') {
      let src = '';
      Object.defineProperty(el, 'src', {
        get() { return src; },
        set(v) { src = rewrite(v); el.setAttribute('src', src); },
        configurable: true,
      });
    }
    if (tag === 'link') {
      let href = '';
      Object.defineProperty(el, 'href', {
        get() { return href; },
        set(v) { href = rewrite(v); el.setAttribute('href', href); },
        configurable: true,
      });
    }
    return el;
  };
})();
window.gitter = {
  async invoke(method, params) {${invokeBody.replace("STRINGS_JSON", JSON.stringify(strings))}},
  onEvent() { return () => {}; },
  winAction() {},
  async isMaximized() { return false; },
};
</` + `script>`;

const distIndex = fs.readFileSync(path.join(root, "web", "dist", "index.html"), "utf8");
const patched = distIndex
  .replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/s, '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; font-src \'self\' data:; connect-src \'self\'">')
  .replace("<title>GitUI</title>", "<title>branches mock</title>")
  .replace("<script", mockScript + "\n  <script");
fs.writeFileSync(path.join(root, "web", "dist", "mock.html"), patched, "utf8");
console.log("web/dist/mock.html written,", (patched.length / 1024).toFixed(1), "KB");

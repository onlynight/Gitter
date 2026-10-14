/**
 * Changes 页视觉验收 harness（dev only, 不随应用发布）：
 * stub window.GITTER_UI / window.gitter（与宿主注入面同构）+ mock RPC
 * （changes.state / changes.diffFile / changes.stage… / ui.emptyHints），
 * 直接从源码装载 ChangesPage（不经页面包产物），浏览器里截图检查亮/暗两档。
 * 当前验收点：提交类型前缀图标下拉（changes-commit-prefix-dropdown-design.md）。
 */
import React from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";
import { ChangesPage } from "../src/pages/ChangesPage";
import { setState } from "../src/state/store";
// DiffView 语法高亮已迁 Monarch（页 manifest dependencies 声明 gitui.lib.monaco，
// loader 先注入）——harness 同构：动态 import 产物（vite 重写 /@fs/，与 files-main.tsx
// 同款；首次 dev 转换较慢，之后走缓存）。IIFE 执行即挂 GITTER_LIBS.monaco / monacoSyntax
await import("../../app/resources/packages/gitui.lib.monaco/monaco.js");

// ---------- theme（tokens 抄自 themes.ts BUILTIN） ----------
const TOKEN_VARS: Record<string, string> = {
  Base: "--c-base", Panel: "--c-panel", Panel2: "--c-panel2", Hover: "--c-hover", Selected: "--c-selected",
  Border: "--c-border", BorderStrong: "--c-border-strong", Accent: "--c-accent",
  AccentHover: "--c-accent-hover", AccentPressed: "--c-accent-pressed", AccentSoft: "--c-accent-soft",
  OnAccent: "--c-on-accent", Text: "--c-text", Text2: "--c-text2", Text3: "--c-text3", Link: "--c-link",
  Green: "--c-green", Red: "--c-red", Amber: "--c-amber",
};
const PALETTES: Record<string, Record<string, string>> = {
  dark: {
    Base: "#14161B99", Panel: "#FFFFFF0A", Panel2: "#FFFFFF12", Hover: "#FFFFFF14", Selected: "#FFFFFF2B",
    Border: "#FFFFFF21", BorderStrong: "#FFFFFF40", Accent: "#EAEAEA", AccentHover: "#FFFFFF",
    AccentPressed: "#C9C9C9", AccentSoft: "#EAEAEA1F", OnAccent: "#14161B",
    Text: "#EAEAEA", Text2: "#A8B0BC", Text3: "#78828E", Link: "#6BABF5",
    Green: "#3FB950", Red: "#F0655A", Amber: "#E3B341",
  },
  light: {
    Base: "#FFFFFF8C", Panel: "#F7F7F814", Panel2: "#EFEFF11F", Hover: "#EBEBEC40", Selected: "#E0E1E359",
    Border: "#E5E5E580", BorderStrong: "#D0D0D0B3", Accent: "#1B1B1B", AccentHover: "#000000",
    AccentPressed: "#3A3A3A", AccentSoft: "#1B1B1B14", OnAccent: "#FFFFFF",
    Text: "#1B1B1B", Text2: "#5C5C5C", Text3: "#8F8F8F", Link: "#0B6BCB",
    Green: "#1A7F37", Red: "#CF222E", Amber: "#BF8700",
  },
};
function applyTheme(base: "dark" | "light") {
  const root = document.documentElement;
  for (const [name, cssVar] of Object.entries(TOKEN_VARS)) {
    root.style.setProperty(cssVar, PALETTES[base][name]);
  }
  root.style.setProperty("color-scheme", base);
  // BUILTIN token 是带 alpha 的叠加色，真应用底下有窗体材质（亚克力）打底；
  // 纯白/纯黑 body 会让对比度失真——铺一层贴近材质的不透明底
  document.body.style.background = base === "light" ? "#F5F5F6" : "#17181D";
}

// ---------- mock RPC ----------
const FILE = (path: string, category: "changes" | "staged" | "unversioned", code: string, added: number | null = null, deleted: number | null = null) =>
  ({ path, category, isConflict: false, added, deleted, code });

const MOCK_STATE = {
  workDir: "D:\\Code\\Gitter",
  changes: [
    FILE("web/src/pages/ChangesPage.tsx", "changes", "M", 38, 6),
    FILE("web/src/styles.css", "changes", "M", 13, 7),
    FILE("docs/changes-commit-prefix-dropdown-design.md", "changes", "A", 96, 0),
  ],
  staged: [
    FILE("web/src/pages/ChangesPage.tsx", "staged", "M", 38, 6),
    FILE("app/resources/Strings.tsv", "staged", "M", 8, 0),
  ],
  unversioned: [FILE("examples/new-demo.ts", "unversioned", "?", null, null)],
  conflicts: [],
  branch: "dev",
  ahead: 2,
  behind: 0,
};

const MOCK_DIFF = (path: string) => ({
  path, oldPath: path, isBinary: false, isNew: false, isDeleted: false, isRenamed: false,
  hunks: [{
    oldStart: 1, oldCount: 6, newStart: 1, newCount: 8,
    oldLines: [
      "const PREFIXES = [\"feat:\", \"fix:\", \"docs:\"];",
      "",
      "export function Demo() {",
      "  return <div className=\"prefix-row\">",
      "    {PREFIXES.map((p) => <Chip key={p}>{p}</Chip>)}",
      "  </div>;",
      "}",
    ],
    newLines: [
      "const PREFIX_ITEMS = [",
      "  { pfx: \"feat:\", descKey: \"Changes_PrefixFeat\" },",
      "  { pfx: \"fix:\", descKey: \"Changes_PrefixFix\" },",
      "];",
      "",
      "export function Demo() {",
      "  // 图标钮 + 向上弹菜单（changes-commit-prefix-dropdown-design.md）",
      "  return <PrefixMenu items={PREFIX_ITEMS} />;",
      "}",
    ],
  }],
  addedLines: 8, deletedLines: 3, oldEndsWithNewline: true, newEndsWithNewline: true,
});

function mockRpc(method: string, params?: Record<string, unknown>): unknown {
  switch (method) {
    case "changes.state": return MOCK_STATE;
    case "changes.diffFile": return MOCK_DIFF(String(params?.path ?? ""));
    case "ui.emptyHints": return [];
    case "ui.commitBlocks": return [];
    case "changes.safetyScan": return { findings: [] };
    case "ai.generateCommitMessage": return { message: "feat(web): 变更页提交前缀收进图标下拉（harness mock）" };
    case "ai.explain": return { text: "（harness mock）这段 diff 把前缀 chips 收进了提交框左上角的图标下拉。" };
    case "changes.stage":
    case "changes.unstage":
    case "changes.fetch":
    case "changes.pull":
    case "changes.push":
    case "changes.commit":
    case "changes.feedback":
    case "review.repair":
    case "branches.create":
      return { ok: true };
    default: return {};
  }
}

// ---------- i18n（ChangesPage 用到的词条；缺词回退 key id） ----------
const I18N: Record<string, string> = {
  Branches_CreateTitle: "创建分支", Branches_Created: "分支已创建：{0}", Branches_NamePlaceholder: "分支名",
  Changes_AgentFeedback: "Agent 反馈：{0}", Changes_Ahead: "领先 {0}", Changes_AheadBehind: "领先 {0} · 落后 {1}",
  Changes_AiExplain: "AI 解释", Changes_AiGenerate: "AI 生成", Changes_AiReview: "AI 审查",
  Changes_BranchSwitch: "切换分支", Changes_ChangesGroup: "变更",
  Changes_Commit: "提交", Changes_CommitAndPush: "提交并推送",
  Changes_CommitMessagePlaceholder: "提交信息（Ctrl+Enter 提交）", Changes_CommitStat: "将提交 {0} 个文件",
  Changes_Committed: "已提交", Changes_CommittedAndPushed: "已提交并推送",
  Changes_ConflictCompareHint: "对比解决冲突", Changes_Conflicts: "冲突",
  Changes_Fetch: "抓取", Changes_Fetched: "已抓取", Changes_FilterPlaceholder: "筛选文件…",
  Changes_IncludeCommit: "包含提交", Changes_JumpToFinding: "跳转到问题行",
  Changes_MarkResolved: "标记已解决", Changes_MoreFindings: "…还有 {0} 条发现", Changes_NoMatch: "无匹配文件",
  Changes_PrefixMenu: "提交类型前缀", Changes_PrefixMenuHint: "仅空消息时插入 · Esc 关闭",
  Changes_PrefixFeat: "新功能", Changes_PrefixFix: "缺陷修复", Changes_PrefixDocs: "文档",
  Changes_PrefixTest: "测试", Changes_PrefixBuild: "构建与依赖", Changes_PrefixChore: "杂项维护",
  Changes_PreviewStaged: "预览已暂存", Changes_PreviewTooLarge: "文件过大，无法预览", Changes_PreviewWorktree: "预览工作区",
  Changes_Pull: "拉取", Changes_PullRebase: "拉取（变基）", Changes_Pulled: "已拉取", Changes_PulledRebase: "已拉取（变基）",
  Changes_Push: "推送", Changes_PushFailed: "推送失败：{0}", Changes_Pushed: "已推送",
  Changes_RepairSent: "已发送修复", Changes_SelectFileHint: "选择文件查看差异", Changes_SendToRepair: "发送修复",
  Changes_SetUpstreamPush: "设置上游并推送", Changes_StageFile: "暂存文件", Changes_StageGroup: "暂存所有变更",
  Changes_StageHunk: "暂存此块", Changes_StageHunkSelected: "暂存所选 {0} 块", Changes_Staged: "已暂存",
  Changes_StagedAll: "已全部暂存", Changes_StagedGroup: "已暂存", Changes_StagedHunks: "已暂存所选块",
  Changes_UnstageFile: "撤销暂存", Changes_UnstageGroup: "全部撤销暂存", Changes_UnstageHunk: "撤销此块",
  Changes_UnstageHunkSelected: "撤销所选 {0} 块", Changes_Unstaged: "已撤销暂存", Changes_UnstagedAll: "已全部撤销暂存",
  Changes_UnstagedHunks: "已撤销所选块", Changes_UnversionedGroup: "未版本控制", Changes_UpstreamPushed: "已推送并设置上游",
  Changes_WorktreeClean: "工作区是干净的",
  Common_Close: "关闭", Common_Collapse: "折叠", Common_Create: "创建", Common_GoToSettings: "打开设置",
  Common_Loading: "加载中…", Common_NoProjectSelected: "未选择项目",
};

// ---------- GITTER_UI / gitter stub（与 harness/main.tsx 同构，子集） ----------
(window as any).GITTER_UI = {
  getActiveCaller: () => null,
  call: (method: string, params?: Record<string, unknown>) => Promise.resolve(mockRpc(method, params)),
  callWith: (_boot: unknown, method: string, params?: Record<string, unknown>) => Promise.resolve(mockRpc(method, params)),
  on: (_method: string, _cb: (p: unknown) => void) => () => {},
  t: (key: string, ...args: unknown[]) => {
    let s = I18N[key] ?? key;
    args.forEach((a, i) => { s = s.replace(`{${i}}`, String(a)); });
    return s;
  },
  navigate: () => {}, openSettings: () => {}, toast: () => {}, refresh: () => {}, notifyRepoChanged: () => {},
  repo: () => "D:\\Code\\Gitter", settings: () => ({}), theme: () => null,
  openRepo: () => {}, closeRepo: () => {}, updateSettings: () => {}, applySettings: () => {},
  reloadTheme: () => {}, clearSettingsFocus: () => {},
  context: () => ({}), setContext: () => {}, focusTask: () => {}, clearTaskFocus: () => {},
  runCommand: () => {}, extTree: () => ({ pages: [], agentUIReg: [] }),
};
// 源码直载：宿主 store 播种（repo 非 null 页面才拉 changes.state；i18n.strings 供 store 内 t() 查词典）。
// theme.syntax 与主进程 BUILTIN_SYNTAX 同源——DiffView Monarch 高亮查这张表取色。
setState({
  booted: true,
  repo: { workDir: "D:\\Code\\Gitter", name: "Gitter" },
  i18n: { lang: "zh-Hans", strings: I18N },
  theme: {
    base: "light", activeId: "harness-builtin", material: "none", themeId: "light",
    tokens: {}, diff: {}, terminal: {},
    syntax: {
      keyword: "#569CD6", string: "#6A9955", comment: "#6A9955", number: "#B5CEA8",
      type: "#4EC9B0", function: "#DCDCAA", variable: "#9CDCFE", operator: "#D4D4D4", punctuation: "#D4D4D4",
    },
  },
});
(window as any).gitter = {
  invoke: async (method: string, params?: unknown) => ({ ok: true, data: mockRpc(method, params as Record<string, unknown>) }),
  onEvent: () => () => {},
  winAction: () => {},
  isMaximized: async () => false,
};

applyTheme("light");
// 渲染期异常外显（React commit 期错误走 window 事件，累积到 __errs 便于定位）
(window as any).__errs = [] as string[];
window.addEventListener("error", (e) => { (window as any).__errs.push(String(e.error?.stack ?? e.message)); });
window.addEventListener("unhandledrejection", (e) => { (window as any).__errs.push(String((e.reason as Error)?.stack ?? e.reason)); });

createRoot(document.getElementById("root")!).render(React.createElement(ChangesPage));

// 主题切换按钮（截图两档用）
const bar = document.createElement("div");
bar.className = "theme-switch";
for (const b of ["dark", "light"]) {
  const btn = document.createElement("button");
  btn.textContent = b;
  btn.className = "tool-btn";
  btn.onclick = () => applyTheme(b as "dark" | "light");
  bar.appendChild(btn);
}
document.body.appendChild(bar);

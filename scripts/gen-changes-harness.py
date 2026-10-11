"""变更页浏览器桩预览生成器（调试用，不参与构建）：
把 app/resources/packages 拷到 web/dist/pkg，生成 __debug.html / __debug-light.html——
内联桥桩（window.gitter）+ file://→/pkg/ 脚本重写 + 全量 i18n/示例数据，
使宿主壳 + 页面包能在纯浏览器里渲染变更页。用法：python scripts/gen-changes-harness.py
（需先 cd web && npm run build）。"""
import io, json, os, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

# ---- 1. 同步页面包 ----
pkg_dst = "web/dist/pkg"
if os.path.isdir(pkg_dst):
    shutil.rmtree(pkg_dst)
shutil.copytree("app/resources/packages", pkg_dst)

# ---- 2. i18n 字典：直接吃 Strings.tsv（zh 缺失回退 en） ----
rows = []
for line in io.open("app/resources/Strings.tsv", encoding="utf-8"):
    line = line.rstrip("\n")
    if not line:
        continue
    parts = line.split("\t")
    if len(parts) >= 3:
        rows.append((parts[0], parts[2] or parts[1]))
strings = {k: v for k, v in rows}

BUILTIN = {
    "dark": {
        "Base": "#14161B99", "Panel": "#FFFFFF0A", "Panel2": "#FFFFFF12", "Hover": "#FFFFFF14", "Selected": "#FFFFFF2B",
        "Border": "#FFFFFF21", "BorderStrong": "#FFFFFF40", "Accent": "#EAEAEA", "AccentHover": "#FFFFFF",
        "AccentPressed": "#C9C9C9", "AccentSoft": "#EAEAEA1F", "OnAccent": "#14161B",
        "Text": "#EAEAEA", "Text2": "#A8B0BC", "Text3": "#78828E", "Link": "#6BABF5",
        "Green": "#3FB950", "Red": "#F0655A", "Amber": "#E3B341",
        "ChipBlueBg": "#25324480", "ChipBlueFg": "#8DB8F5", "ChipPurpleBg": "#2B244080", "ChipPurpleFg": "#B9A3EC",
    },
    "light": {
        "Base": "#FFFFFF8C", "Panel": "#F7F7F814", "Panel2": "#EFEFF11F", "Hover": "#EBEBEC40", "Selected": "#E0E1E359",
        "Border": "#E5E5E580", "BorderStrong": "#D0D0D0B3", "Accent": "#1B1B1B", "AccentHover": "#000000",
        "AccentPressed": "#3A3A3A", "AccentSoft": "#1B1B1B14", "OnAccent": "#FFFFFF",
        "Text": "#1B1B1B", "Text2": "#5C5C5C", "Text3": "#8F8F8F", "Link": "#0B6BCB",
        "Green": "#1A7F37", "Red": "#CF222E", "Amber": "#BF8700",
        "ChipBlueBg": "#DDF4FF66", "ChipBlueFg": "#0B6BCB", "ChipPurpleBg": "#FBEFFF66", "ChipPurpleFg": "#8250DF",
    },
}


def fs(path, cat, added, deleted, code):
    return {"path": path, "category": cat, "isConflict": cat == "conflicts",
            "added": added, "deleted": deleted, "code": code}


STATE = {
    "workDir": "D:/Code/Gitter",
    "branch": "main", "ahead": 1, "behind": 2,
    "conflicts": [fs("app/src/services/worktree_service.rs", "conflicts", None, None, "UU")],
    "staged": [
        fs("web/src/kit/DiffView.tsx", "staged", 96, 14, "M"),
        fs("web/src/bridge/types.ts", "staged", 58, 0, "A"),
    ],
    "changes": [
        fs("web/src/pages/ChangesPage.tsx", "changes", 42, 7, "M"),
        fs("web/src/kit/wordDiff.ts", "changes", 18, 3, "M"),
        fs("app/src/services/git_service.rs", "changes", 77, 22, "M"),
        fs("docs/changes-page.md", "changes", 31, 0, "D"),
        fs("design/changes-left-v2-mockup.html", "changes", 210, 88, "M"),
    ],
    "unversioned": [
        fs("scripts/bench-scroll.mjs", "unversioned", None, None, "?"),
        fs("design/icon-draft.svg", "unversioned", None, None, "?"),
    ],
}


def diff_dto(path):
    return {
        "path": path, "oldPath": path, "isBinary": False, "isNew": False, "isDeleted": False, "isRenamed": False,
        "hunks": [{
            "oldStart": 389, "oldCount": 9, "newStart": 389, "newCount": 12,
            "oldLines": [
                "  const collapsed = collapsedGroups.has(gkey);",
                "  return (",
                "    <div>",
                "      <div className=\"group-header solid\" ...>",
                "        <input type=\"checkbox\" ... />",
                "        <span ...>{collapsed ? '▸' : '▾'}</span>",
                "        <span>{title}</span>",
                "        <span ...>{files.length}</span>",
                "      </div>",
            ],
            "newLines": [
                "  const collapsed = collapsedGroups.has(gkey);",
                "  return (",
                "    <div className=\"chg-group\">",
                "      <div className=\"chg-group-h\" onClick={collapse}>",
                "        <Chevron closed={collapsed} />",
                "        <span>{title}</span>",
                "        <span className=\"chg-cnt\">{files.length}</span>",
                "        <span className=\"chg-gacts\">…</span>",
                "      </div>",
                "      {rows.map(renderRow)}",
                "    </div>",
                "  );",
            ],
        }],
        "addedLines": 58, "deletedLines": 0,
        "oldEndsWithNewline": True, "newEndsWithNewline": True,
    }


SETTINGS = {
    "theme": "dark", "themePackageId": None, "language": "zh-Hans",
    "projects": [{"path": "D:/Code/Gitter", "name": "Gitter"}],
    "currentProjectPath": "D:/Code/Gitter",
    "externalEditor": None, "editorAutoSave": True,
    "lspTypescript": False, "lspTypescriptCommand": "", "lspPython": False, "lspPythonCommand": "",
    "diffMode": "sideBySide", "sidebarCollapsed": False, "bashPath": None,
    "terminalFontFamily": "", "terminalFontSize": 12, "terminalFollowRepo": True, "terminalShell": "powershell",
    "watchWorktree": True, "autoFetch": False, "autoFetchIntervalMinutes": 5, "recentCommands": [],
    "aiProvider": "off", "aiEndpoint": None, "aiModel": None, "aiCliCommand": "", "aiPrivacy": "fullDiff",
    "aiAppendTrailer": False, "aiApiKeyProtected": None, "safetyNet": "warn", "mcpEnabled": False,
    "logSplitterFraction": None, "changesSplitterFraction": None, "terminalDocFraction": None,
    "packages": {}, "confirmedCommands": [], "allowCodePlugins": False,
}

SLOTS = ["projects", "log", "changes", "branches", "tasks", "bash", "files", "office", "settings"]
metas = [{
    "id": "ext.gitui.page.%s.%s" % (s, s), "slot": s, "title": s,
    "entryAbs": "D:/Code/Gitter/app/resources/packages/gitui.page.%s/page.js" % s,
    "packageId": "gitui.page." + s, "permissions": [], "styles": [],
    "lazy": True, "isBuiltIn": True, "icon": None, "svg": None, "docs": None,
} for s in SLOTS]

STUB = """
window.__ERRS = [];
window.addEventListener('error', function(e){ window.__ERRS.push(String(e.message || e)); });
window.addEventListener('unhandledrejection', function(e){ window.__ERRS.push('rej: ' + String(e.reason && e.reason.stack || e.reason)); });

// file:// 页面包 URL → 同源 /pkg/
(function(){
  function rw(v){
    var s = String(v);
    if (!/^file:/i.test(s)) return s;
    var m = s.replace(/^file:\\/\\/\\//i, "").replace(/^[A-Za-z]:\\//, "");
    var i = m.indexOf("app/resources/packages/");
    if (i >= 0) return "/pkg/" + m.slice(i + "app/resources/packages/".length);
    return s;
  }
  var d = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, "src");
  Object.defineProperty(HTMLScriptElement.prototype, "src", {
    set: function(v){ d.set.call(this, rw(v)); },
    get: function(){ return d.get.call(this); },
    configurable: true
  });
  var dl = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, "href");
  Object.defineProperty(HTMLLinkElement.prototype, "href", {
    set: function(v){ try { dl.set.call(this, rw(v)); } catch(e){ dl.set.call(this, v); } },
    get: function(){ return dl.get.call(this); },
    configurable: true
  });
})();

window.__CALLS = [];
window.__THEME = __THEME__;
window.gitter = {
  async invoke(method, params) {
    window.__CALLS.push(method);
    var d = window.__DATA;
    if (d && Object.prototype.hasOwnProperty.call(d, method))
      return { ok: true, data: typeof d[method] === "function" ? d[method](params) : d[method] };
    window.__CALLS.push("MISS:" + method);
    return { ok: true, data: null };
  },
  onEvent() { return () => {}; },
  winAction() {},
  async isMaximized() { return false; },
};
window.__DATA = {
  "settings.get": __SETTINGS__,
  "settings.set": (p) => Object.assign({}, window.__DATA["settings.get"], p.patch),
  "themes.state": { base: window.__THEME, activeId: null, material: "none", themeId: null, tokens: __TOKENS__, diff: {}, terminal: {}, syntax: {} },
  "i18n.strings": { lang: "zh-Hans", strings: __STRINGS__ },
  "commands.list": [],
  "ui.views": [], "ui.panels": [], "ui.statusItems": [],
  "extensions.pages": __METAS__,
  "repo.open": { workDir: "D:/Code/Gitter", name: "Gitter" },
  "changes.state": __STATE__,
  "changes.safetyScan": { findings: [
    { ruleId: "secret", severity: "warning", filePath: "web/src/kit/wordDiff.ts", line: 14, message: "疑似内嵌令牌（示意）" },
  ]},
  "changes.feedback": null,
  "ui.commitBlocks": [],
  "ui.emptyHints": [],
  "highlight.file": () => ({ lines: [] }),
  "diff.notes": [],
  "log.branches": [],
  "changes.diffFile": (p) => Object.assign({}, window.__DIFF_DTO__, { path: p.path || p, oldPath: p.path || p }),
  "file.preview": () => { throw new Error("no"); },
  "ai.generateCommitMessage": () => ({ message: "feat(changes): 左侧文件列表重设计——路径分层、状态徽标、悬停暂存（stub）" }),
  "ai.explain": () => ({ text: "（stub）该文件把旧版平铺分组列表重构为 chg-* 结构：……" }),
};
window.__DIFF_DTO__ = __DIFF_BODY__;
"""

index = io.open("web/dist/index.html", encoding="utf-8").read()
for theme, name in (("dark", "__debug.html"), ("light", "__debug-light.html")):
    body = (STUB
            .replace("__THEME__", json.dumps(theme))
            .replace("__SETTINGS__", json.dumps(SETTINGS))
            .replace("__TOKENS__", json.dumps(BUILTIN[theme]))
            .replace("__STRINGS__", json.dumps(strings, ensure_ascii=False))
            .replace("__METAS__", json.dumps(metas))
            .replace("__STATE__", json.dumps(STATE))
            .replace("__DIFF_BODY__", json.dumps(diff_dto("web/src/bridge/types.ts"))))
    out = index.replace("<body>", "<body>\n<script>\n" + body + "\n</script>", 1)
    assert out != index
    io.open("web/dist/" + name, "w", encoding="utf-8", newline="").write(out)
    print("wrote", name)

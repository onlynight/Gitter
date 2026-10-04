# patch-themeservice.py - rebuild ThemeService with kind-routed import + ActiveSyntax
p = "src/GitUI.Controls/Theme/ThemeService.cs"
raw = open(p, "rb").read()
bom = raw.startswith(b"\xef\xbb\xbf")
s = raw.decode("utf-8-sig" if bom else "utf-8").replace("\r\n", "\n")

def rep(old, new, tag):
    global s
    assert old in s, "anchor missing: " + tag
    s = s.replace(old, new, 1)

# 1) using
rep("using Microsoft.UI.Xaml;",
    "using GitUI.Core.Extensions;\nusing Microsoft.UI.Xaml;", "using")

# 2) ActiveSyntax 属性
rep("""    /// <summary>当前活动主题包。</summary>
    public static ThemePackageInfo? Active { get; private set; }
""",
    """    /// <summary>当前活动主题包。</summary>
    public static ThemePackageInfo? Active { get; private set; }

    /// <summary>活动主题的语法配色（styleKey → hex，含继承合并；代码高亮框架消费）。</summary>
    public static IReadOnlyDictionary<string, string> ActiveSyntax { get; private set; } =
        new Dictionary<string, string>();
""", "activesyntax")


# 4) Apply：禁用过滤 + ActiveSyntax
rep("""        var info = packageId is not null && _packages.TryGetValue(packageId, out var p) ? p : null;
        info ??= _packages.TryGetValue(DefaultPackageId(fallbackBase), out var builtin) ? builtin : null;
        info ??= _packages.Values.FirstOrDefault(x => x.BaseKind == fallbackBase);
        if (info?.ThemeDoc is null)
        {
            // 完全没有可用主题包：保留 TokenRuntime 兜底表
            TokenRuntime.Load(fallbackBase, TokenRuntime.BuiltinDefaults(fallbackBase));
            return false;
        }

        Active = info;
        var tokens = ResolveTokens(info);
        TokenRuntime.Load(info.BaseKind, tokens);
        InjectFramework(info.ThemeDoc);
        Applied?.Invoke(info);
        return true;""",
    """        ThemePackageInfo? info = null;
        if (packageId is not null && _packages.TryGetValue(packageId, out var p)
            && PackageRegistryState.IsEnabled(packageId, "theme"))
        {
            info = p; // 包存在且未被禁用
        }

        info ??= _packages.TryGetValue(DefaultPackageId(fallbackBase), out var builtin) ? builtin : null;
        info ??= _packages.Values.FirstOrDefault(x => x.BaseKind == fallbackBase);
        if (info?.ThemeDoc is null)
        {
            // 完全没有可用主题包：保留 TokenRuntime 兜底表
            ActiveSyntax = new Dictionary<string, string>();
            TokenRuntime.Load(fallbackBase, TokenRuntime.BuiltinDefaults(fallbackBase));
            return false;
        }

        Active = info;
        var tokens = ResolveTokens(info);
        TokenRuntime.Load(info.BaseKind, tokens);
        ActiveSyntax = ResolveSyntax(info);
        InjectFramework(info.ThemeDoc);
        Applied?.Invoke(info);
        return true;""", "apply")

# 5) Scan：禁用过滤 + theme.json 缺失视为损坏
rep("""                var manifest = ThemePackageJson.ParseManifest(File.ReadAllText(manifestPath));
                var themeDoc = ThemePackageJson.ParseTheme(File.ReadAllText(themePath));
                if (manifest is null || themeDoc is null
                    || !manifest.Kinds.Contains("theme", StringComparer.OrdinalIgnoreCase))
                {
                    continue;
                }
""",
    """                var manifest = ThemePackageJson.ParseManifest(File.ReadAllText(manifestPath));
                if (manifest is null || string.IsNullOrWhiteSpace(manifest.Id)
                    || !manifest.Kinds.Contains("theme", StringComparer.OrdinalIgnoreCase)
                    || !PackageRegistryState.IsEnabled(manifest.Id, "theme"))
                {
                    continue; // 非主题种类包 / 已被用户禁用
                }

                var themeDoc = File.Exists(themePath)
                    ? ThemePackageJson.ParseTheme(File.ReadAllText(themePath))
                    : null;
                if (themeDoc is null)
                {
                    continue; // kinds 声明了 theme 但缺少 theme.json → 视为损坏
                }
""", "scan")

# 6) ResolveSyntax + ImportGpk 分流版替换旧 ImportGpk
OLD_IMPORT_START = "    /// <summary>\n    /// 导入 .gpk 主题包"
INJECT_DOC = "    /// <summary>\n    /// 框架键覆盖字典"

NEW_IMPORT = '''    /// <summary>
    /// 导入 .gpk 扩展包（extension-package-framework.md §四）：按 kinds 分流——
    /// 含 theme → 校验 theme/theme.json，安装后返回包 id（调用方设为活动主题）；
    /// 含 syntax → 校验 syntax/highlighters.json，安装后重扫描高亮器（不改变界面主题）。
    /// 两者都无 → 拒绝。返回 (是否成功, 状态文案, 主题包 id 或 null)。
    /// </summary>
    public static (bool Ok, string Status, string? ThemePackageId) ImportGpk(string gpkPath)
    {
        string? temp = null;
        try
        {
            if (!File.Exists(gpkPath))
            {
                return (false, "文件不存在：" + gpkPath, null);
            }

            temp = Path.Combine(Path.GetTempPath(), "gitui-pkg-" + Guid.NewGuid().ToString("N"));
            ZipFile.ExtractToDirectory(gpkPath, temp, overwriteFiles: true);

            var manifestPath = Path.Combine(temp, "manifest.json");
            if (!File.Exists(manifestPath))
            {
                CleanupTemp(temp);
                return (false, "包内缺少 manifest.json", null);
            }

            var manifest = ThemePackageJson.ParseManifest(File.ReadAllText(manifestPath));
            if (manifest is null || string.IsNullOrWhiteSpace(manifest.Id))
            {
                CleanupTemp(temp);
                return (false, "manifest 无效（缺少 id）", null);
            }

            var hasTheme = manifest.Kinds.Contains("theme", StringComparer.OrdinalIgnoreCase);
            var hasSyntax = manifest.Kinds.Contains("syntax", StringComparer.OrdinalIgnoreCase);
            if (!hasTheme && !hasSyntax)
            {
                CleanupTemp(temp);
                return (false, "该包未声明受支持的种类（kinds 需含 theme 或 syntax）", null);
            }

            if (hasTheme && !File.Exists(Path.Combine(temp, "theme", "theme.json")))
            {
                CleanupTemp(temp);
                return (false, "包内缺少 theme/theme.json", null);
            }

            if (hasSyntax && !File.Exists(Path.Combine(temp, "syntax", "highlighters.json")))
            {
                CleanupTemp(temp);
                return (false, "包内缺少 syntax/highlighters.json", null);
            }

            Directory.CreateDirectory(UserPackagesRoot);
            var dest = Path.Combine(UserPackagesRoot, manifest.Id);
            if (Directory.Exists(dest))
            {
                Directory.Delete(dest, recursive: true); // 同 id 覆盖安装（升级）
            }

            Directory.Move(temp, dest);
            temp = null;
            Scan();

            string status;
            string? themeId = null;
            if (hasTheme)
            {
                themeId = manifest.Id;
                status = "已导入并应用主题包：" + manifest.Id;
            }
            else
            {
                GitUI.Diff.Highlighting.HighlighterRegistry.Rescan();
                status = "已导入语法高亮包：" + manifest.Id;
            }

            return (true, status, themeId);
        }
        catch (Exception ex)
        {
            if (temp is not null)
            {
                CleanupTemp(temp);
            }

            return (false, "导入失败：" + ex.Message, null);
        }
    }

    /// <summary>语法配色继承合并：inherits 主题 syntax → 自身 syntax。</summary>
    private static IReadOnlyDictionary<string, string> ResolveSyntax(ThemePackageInfo info)
    {
        var doc = info.ThemeDoc!;
        var syntax = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        if (doc.Inherits is not null && _packages.TryGetValue(doc.Inherits, out var baseTheme)
            && baseTheme.ThemeDoc is not null)
        {
            foreach (var (key, hex) in baseTheme.ThemeDoc.Syntax)
            {
                syntax[key] = hex;
            }
        }

        foreach (var (key, hex) in doc.Syntax)
        {
            syntax[key] = hex;
        }

        return syntax;
    }

'''

start = s.index(OLD_IMPORT_START)
end = s.index(INJECT_DOC)
s = s[:start] + NEW_IMPORT + s[end:]

open(p, "wb").write((b"\xef\xbb\xbf" if bom else b"") + s.replace("\n", "\r\n").encode("utf-8"))
print("ThemeService rebuilt cleanly")

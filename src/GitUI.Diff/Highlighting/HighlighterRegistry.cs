using System.Text.Json;
using GitUI.Core.Extensions;

namespace GitUI.Diff.Highlighting;

/// <summary>
/// 高亮器注册表：内置语法包（Packages/GitUI.syntax.builtin）+ 用户包（%APPDATA%\GitUI\packages）
/// 中 kinds 含 syntax 的 .gpk/目录，扫描其中 syntax/highlighters.json 并注册。
/// 同扩展名：后注册者覆盖内置（用户包优先）。无匹配 → NullHighlighter。
/// </summary>
public static class HighlighterRegistry
{
    private static readonly object _gate = new();
    private static readonly Dictionary<string, ISyntaxHighlighter> _byExtension =
        new(StringComparer.OrdinalIgnoreCase);
    private static readonly List<ISyntaxHighlighter> _all = new();
    private static bool _scanned;

    /// <summary>注册表内容变化（Rescan/卸载后触发；DiffCanvas 据此重解析当前高亮器）。</summary>
    public static event Action? Changed;

    public static IReadOnlyList<ISyntaxHighlighter> All
    {
        get
        {
            EnsureScanned();
            lock (_gate)
            {
                return _all.ToArray();
            }
        }
    }

    /// <summary>按文件路径扩展名解析高亮器；无匹配返回 NullHighlighter。</summary>
    public static ISyntaxHighlighter Resolve(string? path)
    {
        EnsureScanned();

        var ext = Path.GetExtension(path ?? string.Empty);
        if (ext.Length == 0)
        {
            return NullHighlighter.Instance;
        }

        lock (_gate)
        {
            return _byExtension.TryGetValue(ext, out var h) ? h : NullHighlighter.Instance;
        }
    }

    /// <summary>注册（宿主/脚本宿主入口；同扩展名覆盖）。id 相同的重复注册替换旧实例。</summary>
    public static void Register(ISyntaxHighlighter highlighter)
    {
        ArgumentNullException.ThrowIfNull(highlighter);
        EnsureScanned();

        lock (_gate)
        {
            _all.RemoveAll(h => h.Id == highlighter.Id);
            _all.Add(highlighter);
            foreach (var ext in highlighter.Extensions)
            {
                _byExtension[ext] = highlighter;
            }
        }
    }

    /// <summary>清空并重扫（导入新包后调用）。</summary>
    public static void Rescan()
    {
        lock (_gate)
        {
            _byExtension.Clear();
            _all.Clear();
            _scanned = false;
        }

        EnsureScanned();
        Changed?.Invoke();
    }

    private static void EnsureScanned()
    {
        lock (_gate)
        {
            if (_scanned)
            {
                return;
            }

            _scanned = true;
        }

        var builtinRoot = Path.Combine(AppContext.BaseDirectory, "Packages");
        var userRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GitUI", "packages");

        ScanDirectory(Path.Combine(builtinRoot));
        ScanDirectory(userRoot);
    }

    private static void ScanDirectory(string root)
    {
        if (!Directory.Exists(root))
        {
            return;
        }

        foreach (var dir in Directory.EnumerateDirectories(root))
        {
            try
            {
                var manifestPath = Path.Combine(dir, "manifest.json");
                var grammarPath = Path.Combine(dir, "syntax", "highlighters.json");
                if (!File.Exists(manifestPath) || !File.Exists(grammarPath))
                {
                    continue;
                }

                using var manifestDoc = JsonDocument.Parse(File.ReadAllText(manifestPath));
                if (!manifestDoc.RootElement.TryGetProperty("kinds", out var kinds) ||
                    !kinds.EnumerateArray().Any(k =>
                        k.ValueKind == JsonValueKind.String &&
                        string.Equals(k.GetString(), "syntax", StringComparison.OrdinalIgnoreCase)))
                {
                    continue;
                }

                if (!manifestDoc.RootElement.TryGetProperty("id", out var idEl)
                    || !PackageRegistryState.IsEnabled(idEl.GetString() ?? "", "syntax"))
                {
                    continue; // 该包的 syntax 种类被用户禁用
                }

                foreach (var h in DeclarativeHighlighter.LoadAll(File.ReadAllText(grammarPath)))
                {
                    Register(h);
                }

                // TextMate 兼容子集（P4b）：syntax/*.tmLanguage.json
                var syntaxDir = Path.Combine(dir, "syntax");
                if (Directory.Exists(syntaxDir))
                {
                    foreach (var tml in Directory.EnumerateFiles(syntaxDir, "*.tmLanguage.json"))
                    {
                        try
                        {
                            var h = TextMateSubset.Load(File.ReadAllText(tml), Path.GetFileNameWithoutExtension(tml));
                            if (h is not null)
                            {
                                Register(h);
                            }
                        }
                        catch
                        {
                            // 单文件损坏不阻断扫描
                        }
                    }
                }

                // C# 强类型插件（P4c）：syntax/plugins/*.dll 经可收集 ALC 装载
                var pluginsDir = Path.Combine(dir, "syntax", "plugins");
                if (Directory.Exists(pluginsDir))
                {
                    foreach (var dll in Directory.EnumerateFiles(pluginsDir, "*.dll"))
                    {
                        try
                        {
                            foreach (var h in AssemblyHighlighterLoader.Load(dll))
                            {
                                Register(h);
                            }
                        }
                        catch
                        {
                            // 插件故障 → 跳过（不影响其它扩展）
                        }
                    }
                }

                // 脚本高亮器（entryPoints.script → init.js 经 gitui.syntax.register 注册）
                if (manifestDoc.RootElement.TryGetProperty("entryPoints", out var entryPoints)
                    && entryPoints.TryGetProperty("script", out var scriptEl)
                    && scriptEl.ValueKind == JsonValueKind.String)
                {
                    var scriptPath = Path.Combine(dir, scriptEl.GetString() ?? "");
                    if (File.Exists(scriptPath))
                    {
                        try
                        {
                            var host = new ScriptHighlighterHost();
                            host.ExecuteFile(scriptPath);
                            foreach (var h in host.Registered)
                            {
                                Register(h);
                            }
                        }
                        catch
                        {
                            // 脚本包故障（语法错误/初始化超时）→ 跳过该包的脚本部分
                        }
                    }
                }
            }
            catch
            {
                // 单包损坏不阻断扫描（extension-package-framework.md §四）
            }
        }
    }
}

using System.Text.Json;

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

                foreach (var h in DeclarativeHighlighter.LoadAll(File.ReadAllText(grammarPath)))
                {
                    Register(h);
                }
            }
            catch
            {
                // 单包损坏不阻断扫描（extension-package-framework.md §四）
            }
        }
    }
}

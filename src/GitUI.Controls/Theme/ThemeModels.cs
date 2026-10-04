using System.Text.Json;
using System.Text.Json.Serialization;
using Windows.UI;

namespace GitUI.Controls.Theme;

/// <summary>manifest.json（.gpk 包描述，extension-package-framework.md §3.3）。</summary>
public sealed class PackageManifest
{
    public int SchemaVersion { get; set; } = 1;

    public string Id { get; set; } = "";

    public string Name { get; set; } = "";

    public string Version { get; set; } = "1.0.0";

    public List<string> Kinds { get; set; } = new();

    public ThemeMeta? Theme { get; set; }
}

public sealed class ThemeMeta
{
    public string Base { get; set; } = "dark";

    public string? Inherits { get; set; }
}

/// <summary>theme.json（kind=theme 的内容，theme-framework.md §四.2）。</summary>
public sealed class ThemeDocument
{
    public string Id { get; set; } = "";

    public string Name { get; set; } = "";

    public string Base { get; set; } = "dark";

    /// <summary>继承的基座主题 id（内置 gitui.theme.dark / gitui.theme.light）；null = 自身即基座。</summary>
    public string? Inherits { get; set; }

    /// <summary>语义令牌覆盖：键 = TokenKey 名，值 = #AARRGGBB / #RRGGBB。</summary>
    public Dictionary<string, string> Tokens { get; set; } = new();

    /// <summary>语法配色（代码高亮框架 §三；本阶段仅存储，高亮框架实施时消费）。</summary>
    public Dictionary<string, string> Syntax { get; set; } = new();

    /// <summary>框架键覆盖：键 = WinUI 主题资源名，值 = 颜色。缺省由 §四.3 推导。</summary>
    public Dictionary<string, string> Framework { get; set; } = new();

    /// <summary>diff 配色覆盖：键 = DiffColorKind 名（AddedBackground…），值 = 颜色。</summary>
    public Dictionary<string, string> Diff { get; set; } = new();

    /// <summary>终端配色覆盖：键 = background/foreground/cursor/selection/0..15，值 = 颜色。</summary>
    public Dictionary<string, string> Terminal { get; set; } = new();
}

/// <summary>已装载的主题包（扫描结果）。</summary>
public sealed record ThemePackageInfo(
    string Id,
    string Name,
    ThemeBase BaseKind,
    bool IsBuiltin,
    string RootPath,
    PackageManifest Manifest,
    ThemeDocument? ThemeDoc)
{
    /// <summary>包内 preview.png 的绝对路径（无则 null；设置页缩略预览用）。</summary>
    public string? PreviewPath
    {
        get
        {
            var p = Path.Combine(RootPath, "preview.png");
            return File.Exists(p) ? p : null;
        }
    }
}

public static class ThemePackageJson
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static PackageManifest? ParseManifest(string json) =>
        JsonSerializer.Deserialize<PackageManifest>(json, Options);

    public static ThemeDocument? ParseTheme(string json) =>
        JsonSerializer.Deserialize<ThemeDocument>(json, Options);

    public static bool TryParseColor(string? value, out Color color)
    {
        color = default;
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        var hex = value.Trim().TrimStart('#');
        if (hex.Length is not (6 or 8) || !uint.TryParse(hex, System.Globalization.NumberStyles.HexNumber, null, out var argb))
        {
            return false;
        }

        if (hex.Length == 6)
        {
            argb |= 0xFF000000;
        }

        color = Color.FromArgb((byte)(argb >> 24), (byte)(argb >> 16), (byte)(argb >> 8), (byte)argb);
        return true;
    }
}

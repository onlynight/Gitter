namespace GitUI.Core.Settings;

/// <summary>
/// 应用级设置。所有字段带默认值，用于 JSON 序列化/反序列化。
/// </summary>
public sealed class AppSettings
{
    public ThemePreference Theme { get; set; } = ThemePreference.System;

    /// <summary>最近打开的仓库路径，最多 5 个，最新在前。</summary>
    public List<string> RecentRepos { get; set; } = new();

    /// <summary>外部编辑器可执行文件路径，null 表示使用系统默认。</summary>
    public string? ExternalEditor { get; set; }

    /// <summary>Diff 视图默认模式：SideBySide 或 Inline。</summary>
    public DiffViewMode DiffMode { get; set; } = DiffViewMode.SideBySide;

    public static AppSettings Default => new();
}

public enum DiffViewMode
{
    SideBySide = 0,
    Inline = 1,
}

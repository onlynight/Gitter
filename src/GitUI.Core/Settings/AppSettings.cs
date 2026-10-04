using GitUI.Core.Models;

namespace GitUI.Core.Settings;

/// <summary>
/// 应用级设置。所有字段带默认值，用于 JSON 序列化/反序列化。
/// </summary>
public sealed class AppSettings
{
    public ThemePreference Theme { get; set; } = ThemePreference.System;

    /// <summary>主题包 id（theme-framework.md）；null/空 = 按基座使用内置深/浅主题包。</summary>
    public string? ThemePackageId { get; set; }

    /// <summary>最近打开的仓库路径，最多 5 个，最新在前。已由 Projects 取代写入，仅作旧配置迁移来源。</summary>
    public List<string> RecentRepos { get; set; } = new();

    /// <summary>用户显式管理的项目列表（最新添加在前），项目页数据源。</summary>
    public List<ProjectEntry> Projects { get; set; } = new();

    /// <summary>当前项目路径（须存在于 Projects 中，Normalize 强制）；null 表示未选择项目。启动时自动恢复。</summary>
    public string? CurrentProjectPath { get; set; }

    /// <summary>外部编辑器可执行文件路径，null 表示使用系统默认。</summary>
    public string? ExternalEditor { get; set; }

    /// <summary>Diff 视图默认模式：SideBySide 或 Inline。</summary>
    public DiffViewMode DiffMode { get; set; } = DiffViewMode.SideBySide;

    /// <summary>侧边栏是否收起（仅显示图标）。</summary>
    public bool SidebarCollapsed { get; set; } = false;

    /// <summary>bash.exe 手动指定路径；null/空表示自动定位（三级回退）。</summary>
    public string? BashPath { get; set; }

    /// <summary>终端字体族，默认 Cascadia Mono（缺失时回退 Consolas）。</summary>
    public string TerminalFontFamily { get; set; } = "Cascadia Mono";

    /// <summary>终端字号（逻辑像素），Normalize 约束在 [8, 32]。</summary>
    public double TerminalFontSize { get; set; } = 13;

    /// <summary>终端是否跟随当前仓库切换工作目录（Ctrl+Shift+J 切换）。</summary>
    public bool TerminalFollowRepo { get; set; } = true;

    /// <summary>终端 shell：powershell（默认，系统内置）/ cmd（系统内置）/ bash（需 Git for Windows）。</summary>
    public string TerminalShell { get; set; } = TerminalShellKind.PowerShell;

    /// <summary>命令面板最近执行的命令（命令标题作 key），最多 8 条，最新在前。空查询时置顶显示。</summary>
    public List<string> RecentCommands { get; set; } = new();

    /// <summary>归一化终端 shell 值（未知值回退 PowerShell）。</summary>
    public void NormalizeTerminalShell()
    {
        var v = (TerminalShell ?? string.Empty).Trim().ToLowerInvariant();
        TerminalShell = v switch
        {
            TerminalShellKind.Cmd => TerminalShellKind.Cmd,
            TerminalShellKind.Bash => TerminalShellKind.Bash,
            _ => TerminalShellKind.PowerShell,
        };
    }

    public static AppSettings Default => new();
}

public enum DiffViewMode
{
    SideBySide = 0,
    Inline = 1,
}

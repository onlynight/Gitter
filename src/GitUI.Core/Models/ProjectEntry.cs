namespace GitUI.Core.Models;

/// <summary>
/// 项目 = 用户显式加入项目列表的本地文件夹。
/// Path 是唯一标识（归一化后的完整路径）；Name 为显示名，空时由 Normalize 取文件夹名。
/// 允许非 Git 仓库目录（可先加目录后 init），打开时由各功能页报告错误。
/// </summary>
public sealed class ProjectEntry
{
    public string Path { get; set; } = "";

    public string Name { get; set; } = "";

    public DateTimeOffset AddedAt { get; set; }

    /// <summary>最近一次被设为当前项目的时间；从未选中过为 null。</summary>
    public DateTimeOffset? LastOpenedAt { get; set; }
}

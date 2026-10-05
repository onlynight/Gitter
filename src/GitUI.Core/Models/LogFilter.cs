namespace GitUI.Core.Models;

/// <summary>
/// Log 查询的过滤与分页参数。不可变。
/// 字段语义对齐 <c>git log</c> 的等价参数。
/// </summary>
/// <param name="Author">作者姓名或邮箱子串。null 表示不过滤。</param>
/// <param name="Topic">提交信息正则匹配。null 表示不过滤。</param>
/// <param name="Branch">限定只走某个 ref 可达的提交，如 <c>main</c>。null 表示从 HEAD 走。</param>
/// <param name="After">仅包含此时刻之后的提交。null 表示不限。</param>
/// <param name="Before">仅包含此时刻之前的提交。null 表示不限。</param>
/// <param name="Agent">AI 署名过滤（ai-native-redesign.md §5.2）：null 不过滤；"*" = 任意
/// Assisted-by trailer；其他值 = Assisted-by 含该子串（大小写不敏感）。</param>
/// <param name="Limit">本页最多返回条数，默认 50。&lt;=0 表示不限制。</param>
/// <param name="Skip">跳过的提交数，用于分页。</param>
public sealed record LogFilter(
    string? Author = null,
    string? Topic = null,
    string? Branch = null,
    DateTimeOffset? After = null,
    DateTimeOffset? Before = null,
    string? Agent = null,
    int Limit = 50,
    int Skip = 0)
{
    /// <summary>从 HEAD 无过滤的默认查询。</summary>
    public static LogFilter Default { get; } = new();

    /// <summary>全量查询（Limit 不限制），用于测试。</summary>
    public static LogFilter All { get; } = new(Limit: 0);

    /// <summary>归一化非法值：负数 Limit/Skip 视为 0。</summary>
    public LogFilter Normalize() => this with
    {
        Limit = Limit < 0 ? 0 : Limit,
        Skip = Skip < 0 ? 0 : Skip,
    };
}

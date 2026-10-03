using GitUI.Core.Models;

namespace GitUI.ViewModels;

/// <summary>按天分组后的一个组。不可变。组内提交保持传入顺序（时间倒序）。</summary>
public sealed record LogDayGroup(DateTime Day, string Title, IReadOnlyList<CommitNode> Commits);

/// <summary>提交序列 → 按天分组（design.md §8-S4"按天分组折叠"）。分组键为提交者日期（本地时区）。</summary>
public static class LogDayGrouping
{
    /// <param name="today">锚定"今天"，默认当前本地日期；测试注入固定值。</param>
    public static List<LogDayGroup> Group(IEnumerable<CommitNode> commits, DateTime? today = null)
    {
        var anchor = (today ?? DateTime.Today).Date;
        var map = new Dictionary<DateTime, List<CommitNode>>();
        foreach (var c in commits)
        {
            var day = c.CommitterDate.LocalDateTime.Date;
            if (!map.TryGetValue(day, out var list))
                map[day] = list = new List<CommitNode>();
            list.Add(c);
        }

        return map
            .OrderByDescending(kv => kv.Key)
            .Select(kv => new LogDayGroup(kv.Key, LogFormatting.DayTitle(kv.Key, anchor), kv.Value))
            .ToList();
    }
}

namespace GitUI.ViewModels;

/// <summary>
/// Log 页的显示文案格式化（纯函数，日期相关判定都以本地时区为准）。
/// 分组与行内相对时间统一使用提交者日期（CommitterDate），与 GetLog 的排序键一致，
/// 避免"作者日期 3 天前"的提交出现在"今天"分组下的错位观感。
/// </summary>
public static class LogFormatting
{
    /// <summary>相对时间：今天/昨天/前天显示时刻，近 30 天显示天数，同年显示月日，其余带年份。</summary>
    public static string Relative(DateTimeOffset when, DateTimeOffset now)
    {
        var local = when.LocalDateTime;
        var today = now.LocalDateTime.Date;
        var day = local.Date;

        if (day == today) return local.ToString("HH:mm");
        if (day == today.AddDays(-1)) return "昨天 " + local.ToString("HH:mm");
        if (day == today.AddDays(-2)) return "前天 " + local.ToString("HH:mm");

        var days = (int)(today - day).TotalDays;
        if (days < 30) return $"{days} 天前";
        if (local.Year == now.LocalDateTime.Year) return local.ToString("M月d日");
        return local.ToString("yyyy年M月d日");
    }

    /// <summary>分组头标题：今天/昨天带相对称谓，同年省略年份。</summary>
    public static string DayTitle(DateTime day, DateTime today)
    {
        var wd = "日一二三四五六"[(int)day.DayOfWeek].ToString();
        if (day == today) return $"今天 · {day:M月d日} 星期{wd}";
        if (day == today.AddDays(-1)) return $"昨天 · {day:M月d日} 星期{wd}";
        if (day.Year == today.Year) return $"{day:M月d日} 星期{wd}";
        return $"{day:yyyy年M月d日} 星期{wd}";
    }
}

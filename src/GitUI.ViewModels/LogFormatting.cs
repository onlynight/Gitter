using System.Globalization;
using GitUI.Core.Resources;

namespace GitUI.ViewModels;

/// <summary>
/// Log 页的显示文案格式化（纯函数，日期相关判定都以本地时区为准）。
/// 分组与行内相对时间统一使用提交者日期（CommitterDate），与 GetLog 的排序键一致，
/// 避免"作者日期 3 天前"的提交出现在"今天"分组下的错位观感。
/// 文案/日期模式取自本地化资源（docs/i18n.md §五-2），跟随当前 UI 文化。
/// </summary>
public static class LogFormatting
{
    /// <summary>
    /// 日期格式化文化：语言显式指定时跟随之（进程级一致，含 VM 线程池续体）；
    /// 跟随系统时用当前线程文化。
    /// </summary>
    private static CultureInfo FormatCulture => Strings.Culture ?? CultureInfo.CurrentCulture;

    /// <summary>相对时间：今天/昨天/前天显示时刻，近 30 天显示天数，同年显示月日，其余带年份。</summary>
    public static string Relative(DateTimeOffset when, DateTimeOffset now)
    {
        var local = when.LocalDateTime;
        var today = now.LocalDateTime.Date;
        var day = local.Date;
        var time = local.ToString("HH:mm", FormatCulture);

        if (day == today) return time;
        if (day == today.AddDays(-1)) return string.Format(Strings.Time_Yesterday, time);
        if (day == today.AddDays(-2)) return string.Format(Strings.Time_DayBefore, time);

        var days = (int)(today - day).TotalDays;
        if (days < 30) return string.Format(Strings.Time_DaysAgo, days);
        if (local.Year == now.LocalDateTime.Year) return local.ToString(Strings.Time_MonthDay, FormatCulture);
        return local.ToString(Strings.Time_MonthDayYear, FormatCulture);
    }

    /// <summary>分组头标题：今天/昨天带相对称谓，同年省略年份。</summary>
    public static string DayTitle(DateTime day, DateTime today)
    {
        var weekdays = Strings.Time_Weekdays.Split(',');
        var wd = weekdays[(int)day.DayOfWeek];
        var date = day.ToString(day.Year == today.Year ? Strings.Time_MonthDay : Strings.Time_MonthDayYear, FormatCulture);

        if (day == today) return string.Format(Strings.Time_Today, date, wd);
        if (day == today.AddDays(-1)) return string.Format(Strings.Time_YesterdayDay, date, wd);
        return string.Format(Strings.Time_PlainDay, date, wd);
    }
}

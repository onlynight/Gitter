using GitUI.ViewModels;
using Xunit;

namespace GitUI.ViewModels.Tests;

/// <summary>相对时间与分组标题文案。</summary>
public sealed class LogFormattingTests
{
    // 与 Relative 的 LocalDateTime 语义一致：测试基准也用本地时区
    private static readonly DateTimeOffset Now =
        new DateTimeOffset(2026, 10, 3, 18, 0, 0, TimeZoneInfo.Local.GetUtcOffset(new DateTime(2026, 10, 3)));

    private static DateTimeOffset At(int year, int month, int day, int hour) =>
        new(year, month, day, hour, 0, 0, Now.Offset);

    [Fact]
    public void Relative_Today_ShowsClockTime()
    {
        var when = Now.AddHours(-2);
        Assert.Equal("16:00", LogFormatting.Relative(when, Now));
    }

    [Fact]
    public void Relative_Yesterday()
    {
        Assert.Equal("昨天 09:00", LogFormatting.Relative(Now.AddDays(-1).AddHours(-9), Now));
    }

    [Fact]
    public void Relative_DaysAgo()
    {
        Assert.Equal("5 天前", LogFormatting.Relative(Now.AddDays(-5), Now));
    }

    [Fact]
    public void Relative_WithinYear_ShowsMonthDay()
    {
        Assert.Equal("6月15日", LogFormatting.Relative(At(2026, 6, 15, 8), Now));
    }

    [Fact]
    public void Relative_OtherYear_ShowsYear()
    {
        Assert.Equal("2025年12月30日", LogFormatting.Relative(At(2025, 12, 30, 8), Now));
    }

    [Fact]
    public void Relative_DayCountBoundary()
    {
        // <30 天显示"天数"，≥30 天显示日期
        Assert.Equal("29 天前", LogFormatting.Relative(Now.AddDays(-29), Now));
        Assert.Equal("9月3日", LogFormatting.Relative(Now.AddDays(-30), Now));
    }
}

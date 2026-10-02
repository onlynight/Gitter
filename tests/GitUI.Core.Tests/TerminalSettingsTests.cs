using System.Text;
using GitUI.Core.Settings;
using Xunit;

namespace GitUI.Core.Tests;

/// <summary>
/// S0b：AppSettings 终端字段的反序列化与归一化。
/// 覆盖场景：默认值、正常 round-trip、越界归一化、JSON 缺失字段、损坏文件回退。
/// （2026-10-03：Git Bash 改为导航页签承载，ConsolePaneCollapsed/ConsolePaneWidth 字段移除。）
/// </summary>
public sealed class TerminalSettingsTests : IDisposable
{
    private readonly string _dir;
    private readonly string _path;

    public TerminalSettingsTests()
    {
        _dir = Path.Combine(Path.GetTempPath(), "gitui-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_dir);
        _path = Path.Combine(_dir, "settings.json");
    }

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch { }
    }

    [Fact]
    public void TerminalFields_HaveSensibleDefaults()
    {
        var settings = AppSettings.Default;

        Assert.Null(settings.BashPath);
        Assert.Equal("Cascadia Mono", settings.TerminalFontFamily);
        Assert.Equal(13, settings.TerminalFontSize);
        Assert.True(settings.TerminalFollowRepo);
    }

    [Fact]
    public void TerminalFields_RoundTripThroughFile()
    {
        var store = new JsonSettingsStore(_path);
        store.Update(s =>
        {
            s.BashPath = @"D:\Tools\Git\bin\bash.exe";
            s.TerminalFontFamily = "Consolas";
            s.TerminalFontSize = 15.5;
            s.TerminalFollowRepo = false;
        });
        Assert.True(store.Save());

        var store2 = new JsonSettingsStore(_path);
        Assert.True(store2.Load());

        Assert.Equal(@"D:\Tools\Git\bin\bash.exe", store2.Current.BashPath);
        Assert.Equal("Consolas", store2.Current.TerminalFontFamily);
        Assert.Equal(15.5, store2.Current.TerminalFontSize);
        Assert.False(store2.Current.TerminalFollowRepo);
    }

    [Theory]
    [InlineData(100, 32)]
    [InlineData(0, 8)]
    [InlineData(2, 8)]
    [InlineData(64, 32)]
    public void TerminalFontSize_OutOfRange_IsNormalized(double written, double expected)
    {
        var store = new JsonSettingsStore(_path);
        store.Update(s => s.TerminalFontSize = written);

        Assert.Equal(expected, store.Current.TerminalFontSize);
    }

    [Fact]
    public void TerminalFields_NonFiniteNumbers_FallBackToDefaults()
    {
        // Update 内部会走 Normalize：非有限值必须归一到默认而不是原样写入
        var store = new JsonSettingsStore(_path);
        store.Update(s => s.TerminalFontSize = double.PositiveInfinity);

        Assert.Equal(13, store.Current.TerminalFontSize);
    }

    [Fact]
    public void TerminalFields_MissingFromJson_UseDefaults()
    {
        // 只含主题字段的旧版设置文件：终端字段必须全部落到默认值
        File.WriteAllText(_path, "{\"theme\":\"Dark\"}", Encoding.UTF8);

        var store = new JsonSettingsStore(_path);
        Assert.True(store.Load());

        Assert.Equal(ThemePreference.Dark, store.Current.Theme);
        Assert.Null(store.Current.BashPath);
        Assert.Equal("Cascadia Mono", store.Current.TerminalFontFamily);
        Assert.Equal(13, store.Current.TerminalFontSize);
        Assert.True(store.Current.TerminalFollowRepo);
    }

    [Fact]
    public void TerminalFields_WhenFileCorrupted_FallBackToDefaults()
    {
        File.WriteAllText(_path, "{\"terminalFontSize\": \"}}}garbage", Encoding.UTF8);

        var store = new JsonSettingsStore(_path);
        Assert.False(store.Load());

        Assert.Equal(13, store.Current.TerminalFontSize);
        Assert.True(store.Current.TerminalFollowRepo);
    }

    [Fact]
    public void TerminalFollowRepo_PersistsAcrossReload()
    {
        var store = new JsonSettingsStore(_path);
        store.Update(s => s.TerminalFollowRepo = false);
        Assert.True(store.Save());

        var store2 = new JsonSettingsStore(_path);
        Assert.True(store2.Load());
        Assert.False(store2.Current.TerminalFollowRepo);
    }

    [Fact]
    public void BashPath_Whitespace_IsNormalizedToNull()
    {
        var store = new JsonSettingsStore(_path);
        store.Update(s => s.BashPath = "   ");

        Assert.Null(store.Current.BashPath);
    }

    [Fact]
    public void LegacyConsolePaneFields_UnknownJsonKeys_AreIgnored()
    {
        // 旧版设置文件里的 consolePane* 字段（右侧面板时代）加载时必须被忽略而不是报错
        File.WriteAllText(
            _path,
            "{\"theme\":\"Dark\",\"consolePaneCollapsed\":true,\"consolePaneWidth\":720}",
            Encoding.UTF8);

        var store = new JsonSettingsStore(_path);
        Assert.True(store.Load());
        Assert.Equal(ThemePreference.Dark, store.Current.Theme);
    }
}

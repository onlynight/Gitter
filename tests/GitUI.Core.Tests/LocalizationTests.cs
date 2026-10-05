using System.Globalization;
using System.Resources;
using GitUI.Core.Resources;
using GitUI.Core.Settings;
using Xunit;

namespace GitUI.Core.Tests;

/// <summary>
/// i18n 基建测试（docs/i18n.md §七）：
/// LanguageService 三档解析与应用、资源 key 中英对齐、占位符一致性。
/// </summary>
public class LocalizationTests
{
    // ---- LanguageService ----

    [Theory]
    [InlineData(null, LanguagePreference.System)]
    [InlineData("", LanguagePreference.System)]
    [InlineData("fr-FR", LanguagePreference.System)]
    [InlineData("system", LanguagePreference.System)]
    [InlineData("SYSTEM", LanguagePreference.System)]
    [InlineData("en", LanguagePreference.English)]
    [InlineData("en ", LanguagePreference.English)]
    [InlineData("zh-Hans", LanguagePreference.SimplifiedChinese)]
    [InlineData("zh-hans", LanguagePreference.SimplifiedChinese)]
    public void Normalize_MapsKnownValuesAndFallsBackToSystem(string? input, string expected)
    {
        Assert.Equal(expected, LanguageService.Normalize(input));
    }

    [Fact]
    public void Apply_English_SetsUICultureToEnglish()
    {
        var savedUi = CultureInfo.DefaultThreadCurrentUICulture;
        var savedCulture = CultureInfo.DefaultThreadCurrentCulture;
        var savedStrings = Strings.Culture;
        try
        {
            LanguageService.Apply(LanguagePreference.English);
            Assert.Equal("en", CultureInfo.DefaultThreadCurrentUICulture?.Name);
            Assert.Equal("en", CultureInfo.DefaultThreadCurrentCulture?.Name);
            Assert.Equal("en", Strings.Culture?.Name);
        }
        finally
        {
            CultureInfo.DefaultThreadCurrentUICulture = savedUi;
            CultureInfo.DefaultThreadCurrentCulture = savedCulture;
            Strings.Culture = savedStrings;
        }
    }

    [Fact]
    public void Apply_Chinese_SetsUICultureToChineseSimplified()
    {
        var savedUi = CultureInfo.DefaultThreadCurrentUICulture;
        var savedCulture = CultureInfo.DefaultThreadCurrentCulture;
        var savedStrings = Strings.Culture;
        try
        {
            LanguageService.Apply(LanguagePreference.SimplifiedChinese);
            Assert.Equal("zh-Hans", CultureInfo.DefaultThreadCurrentUICulture?.Name);
            Assert.Equal("zh-Hans", Strings.Culture?.Name);
        }
        finally
        {
            CultureInfo.DefaultThreadCurrentUICulture = savedUi;
            CultureInfo.DefaultThreadCurrentCulture = savedCulture;
            Strings.Culture = savedStrings;
        }
    }

    [Fact]
    public void Apply_System_ClearsOverrides()
    {
        // 跟随系统 = 清除全部覆盖（含此前 Apply(en/zh) 留下的），线程文化恢复系统快照
        var savedUi = CultureInfo.DefaultThreadCurrentUICulture;
        var savedCulture = CultureInfo.DefaultThreadCurrentCulture;
        var savedStrings = Strings.Culture;
        try
        {
            LanguageService.Apply(LanguagePreference.English);
            LanguageService.Apply(LanguagePreference.System);
            Assert.Null(CultureInfo.DefaultThreadCurrentUICulture);
            Assert.Null(CultureInfo.DefaultThreadCurrentCulture);
            Assert.Null(Strings.Culture);
            // 当前线程此前被 Apply(en) 显式设过，必须回到系统快照——否则资源查找
            // 回落线程文化后界面卡在上一语言
            Assert.Equal(LanguageService.SystemUICultureSnapshot.Name, CultureInfo.CurrentUICulture.Name);
            Assert.Equal(LanguageService.SystemCultureSnapshot.Name, CultureInfo.CurrentCulture.Name);
        }
        finally
        {
            CultureInfo.DefaultThreadCurrentUICulture = savedUi;
            CultureInfo.DefaultThreadCurrentCulture = savedCulture;
            Strings.Culture = savedStrings;
        }
    }

    [Fact]
    public void Apply_RaisesAppliedWithNormalizedValue()
    {
        var savedStrings = Strings.Culture;
        string? received = null;
        Action<string> handler = v => received = v;
        LanguageService.Applied += handler;
        try
        {
            LanguageService.Apply("zh-hans");
            Assert.Equal(LanguagePreference.SimplifiedChinese, received);
        }
        finally
        {
            LanguageService.Applied -= handler;
            Strings.Culture = savedStrings;
        }
    }

    // ---- 资源完整性（key-parity / 占位符）----

    [Fact]
    public void SatelliteResources_CoverAllNeutralKeys()
    {
        var en = LoadSet(CultureInfo.InvariantCulture);
        var zh = LoadSet(new CultureInfo("zh-Hans"));

        Assert.NotEmpty(en);
        var missing = en.Keys.Except(zh.Keys).OrderBy(k => k).ToList();
        Assert.True(missing.Count == 0, "zh-Hans 缺失 key: " + string.Join(", ", missing));
        var extra = zh.Keys.Except(en.Keys).OrderBy(k => k).ToList();
        Assert.True(extra.Count == 0, "zh-Hans 多出 key: " + string.Join(", ", extra));
    }

    [Fact]
    public void PlaceholderShape_MatchesAcrossCultures()
    {
        var en = LoadSet(CultureInfo.InvariantCulture);
        var zh = LoadSet(new CultureInfo("zh-Hans"));

        foreach (var (key, enValue) in en)
        {
            var zhValue = zh.GetValueOrDefault(key);
            Assert.False(string.IsNullOrWhiteSpace(zhValue), $"zh-Hans 空值: {key}");
            Assert.Equal(PlaceholderShape(enValue), PlaceholderShape(zhValue));
        }
    }

    [Fact]
    public void GetString_ResolvesByCurrentUICulture()
    {
        // GetString(key, null) 走当前线程的 CurrentUICulture（线程级，xUnit 并行安全）；
        // 进程级 Strings.Culture 覆盖须先清空，避免并行 Apply 测试的副作用串扰
        var saved = CultureInfo.CurrentUICulture;
        var savedStrings = Strings.Culture;
        try
        {
            Strings.Culture = null;
            CultureInfo.CurrentUICulture = new CultureInfo("zh-Hans");
            Assert.Equal("取消", Strings.Common_Cancel);

            CultureInfo.CurrentUICulture = new CultureInfo("en");
            Assert.Equal("Cancel", Strings.Common_Cancel);
        }
        finally
        {
            CultureInfo.CurrentUICulture = saved;
            Strings.Culture = savedStrings;
        }
    }

    private static Dictionary<string, string> LoadSet(CultureInfo culture)
    {
        var rm = new ResourceManager(typeof(Strings));
        var set = rm.GetResourceSet(culture, createIfNotExists: true, tryParents: true)
            ?? throw new InvalidOperationException("resource set missing: " + culture);
        return set.OfType<System.Collections.DictionaryEntry>()
            .ToDictionary(e => (string)e.Key, e => (string)e.Value!);
    }

    private static string PlaceholderShape(string text) =>
        string.Concat(System.Text.RegularExpressions.Regex.Matches(text, @"\{\d+\}")
            .Select(m => m.Value).OrderBy(v => v));
}

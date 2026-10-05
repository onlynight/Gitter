using System.Globalization;

using GitUI.Core.Resources;

namespace GitUI.Core.Settings;

/// <summary>语言偏好值（settings.json 的 language 字段；docs/i18n.md §三）。</summary>
public static class LanguagePreference
{
    /// <summary>跟随系统（不覆盖线程文化）。</summary>
    public const string System = "system";

    /// <summary>English（中性语言，缺项回退）。</summary>
    public const string English = "en";

    /// <summary>简体中文（卫星资源 zh-Hans）。</summary>
    public const string SimplifiedChinese = "zh-Hans";
}

/// <summary>
/// 语言服务：解析 language 偏好并应用到线程文化（docs/i18n.md §三）。
/// 静态服务，镜像 ThemeService 的形态；v1 切换语言后重启生效，
/// <see cref="Applied"/> 事件为后续热切换预留（当前无订阅方）。
/// </summary>
public static class LanguageService
{
    /// <summary>语言应用完成后广播（值 = 归一化后的偏好）。热切换时各窗口订阅重绘。</summary>
    public static event Action<string>? Applied;

    /// <summary>进程启动时的系统文化快照（类型初始化时捕获，尚无任何覆盖）；
    /// "跟随系统"档用它恢复线程级文化——CurrentUICulture 被显式设置后 .NET 无"清除"API，必须记底稿。</summary>
    public static CultureInfo SystemUICultureSnapshot { get; } = CultureInfo.CurrentUICulture;

    /// <summary>同 <see cref="SystemUICultureSnapshot"/>，日期/数字格式文化。</summary>
    public static CultureInfo SystemCultureSnapshot { get; } = CultureInfo.CurrentCulture;

    /// <summary>归一化偏好：大小写不敏感；未知/空值回退跟随系统。</summary>
    public static string Normalize(string? preference) => preference?.Trim().ToLowerInvariant() switch
    {
        LanguagePreference.English => LanguagePreference.English,
        "zh-hans" => LanguagePreference.SimplifiedChinese,
        _ => LanguagePreference.System,
    };

    /// <summary>
    /// 把语言偏好应用到当前进程，立即生效（docs/i18n.md §四 热切换）：
    /// 1. <see cref="Strings.Culture"/> 进程级资源查找覆盖——任意线程（含 VM 线程池续体）
    ///    的 Strings 取值即时切到新语言；
    /// 2. Default* 文化作为新线程种子 + 当前线程立即切换——影响日期/数字格式；
    /// 3. 广播 <see cref="Applied"/>，各窗口订阅后重绘静态文案。
    /// 跟随系统时清除全部覆盖。
    /// </summary>
    public static void Apply(string? preference)
    {
        var normalized = Normalize(preference);
        var culture = normalized switch
        {
            LanguagePreference.English => new CultureInfo("en"),
            LanguagePreference.SimplifiedChinese => new CultureInfo("zh-Hans"),
            _ => null,
        };

        Strings.Culture = culture;

        if (culture is not null)
        {
            CultureInfo.DefaultThreadCurrentUICulture = culture;
            CultureInfo.DefaultThreadCurrentCulture = culture;
            CultureInfo.CurrentUICulture = culture;
            CultureInfo.CurrentCulture = culture;
        }
        else
        {
            // 跟随系统：Default* 置空（新线程回种子 OS 文化）；
            // 当前线程此前可能被 Apply(en/zh) 显式设置过，必须恢复快照，否则资源查找
            // 回落到线程文化后界面卡在上一语言（热切换"点了没反应"的根因）。
            CultureInfo.DefaultThreadCurrentUICulture = null;
            CultureInfo.DefaultThreadCurrentCulture = null;
            CultureInfo.CurrentUICulture = SystemUICultureSnapshot;
            CultureInfo.CurrentCulture = SystemCultureSnapshot;
        }

        Applied?.Invoke(normalized);
    }
}

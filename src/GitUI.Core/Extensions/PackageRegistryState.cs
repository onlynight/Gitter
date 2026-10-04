namespace GitUI.Core.Extensions;

/// <summary>
/// 扩展包注册的共享运行态（extension-package-framework.md §四）：
/// 跨种类（theme/syntax/…）的启用/禁用清单。宿主在启动时从 settings 装入，
/// 设置页切换时更新并持久化；各消费服务（ThemeService / HighlighterRegistry）据此过滤。
/// 条目格式："包id:种类"（如 "com.x:theme"）。
/// </summary>
public static class PackageRegistryState
{
    public static readonly HashSet<string> DisabledKinds = new(StringComparer.OrdinalIgnoreCase);

    public static bool IsEnabled(string packageId, string kind) =>
        !DisabledKinds.Contains(packageId + ":" + kind, StringComparer.OrdinalIgnoreCase);

    public static void SetEnabled(string packageId, string kind, bool enabled)
    {
        var entry = packageId + ":" + kind;
        if (enabled)
        {
            DisabledKinds.Remove(entry);
        }
        else
        {
            DisabledKinds.Add(entry);
        }
    }

    /// <summary>从持久化清单装入（settings.DisabledPackageKinds）。</summary>
    public static void LoadFrom(IEnumerable<string>? disabledKinds)
    {
        DisabledKinds.Clear();
        if (disabledKinds is null)
        {
            return;
        }

        foreach (var entry in disabledKinds)
        {
            if (!string.IsNullOrWhiteSpace(entry))
            {
                DisabledKinds.Add(entry);
            }
        }
    }
}

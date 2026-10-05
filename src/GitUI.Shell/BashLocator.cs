namespace GitUI.Shell;

/// <summary>定位失败原因（语言中立；UI 层负责转本地化文案，docs/i18n.md §五-5）。</summary>
public enum BashLocateFailureKind
{
    /// <summary>手动指定的路径不存在（Detail = 规范化后的路径）。</summary>
    CustomPathMissing,

    /// <summary>三级回退全部落空，未找到 bash.exe。</summary>
    NotFound,
}

/// <summary>定位失败的详细信息。</summary>
public sealed record BashLocateError(BashLocateFailureKind Kind, string? Detail);

/// <summary>
/// bash.exe 定位器，三级回退（design.md §4.7.5 / S0c）：
/// 1. settings.BashPath 手动指定路径；
/// 2. PATH 目录扫描（等价于 <c>where bash.exe</c>，避免起子进程）；
/// 3. Git for Windows 默认安装目录（ProgramFiles / ProgramFiles(x86) / LocalAppData）。
/// 所有候选的探测异常（权限不足等）都吞掉并继续下一级，不抛给调用方。
/// </summary>
public static class BashLocator
{
    /// <summary>安装目录下 bash.exe 的相对路径。</summary>
    private const string GitRelativePath = "bin\\bash.exe";

    public static bool TryLocate(string? overridePath, out string bashPath, out BashLocateError? error)
    {
        return TryLocate(
            overridePath,
            Environment.GetEnvironmentVariable("PATH"),
            GetGitInstallRoots(),
            File.Exists,
            out bashPath,
            out error);
    }

    /// <summary>
    /// 可注入内核：单测通过注入 PATH 环境、候选安装根目录与文件存在性断言来覆盖
    /// 全部回退路径，不依赖真实机器上的 Git 安装状态。
    /// </summary>
    internal static bool TryLocate(
        string? overridePath,
        string? pathEnv,
        IReadOnlyList<string> gitInstallRoots,
        Func<string, bool> fileExists,
        out string bashPath,
        out BashLocateError? error)
    {
        bashPath = string.Empty;
        BashLocateError? lastError = null;

        // ---- 一级：手动指定路径 ----
        var trimmed = overridePath?.Trim().Trim('"');
        if (!string.IsNullOrWhiteSpace(trimmed))
        {
            if (TryProbe(trimmed, fileExists, out bashPath))
            {
                error = null;
                return true;
            }

            // 手动路径失效时记录原因，继续向下回退而不是直接失败
            lastError = new BashLocateError(BashLocateFailureKind.CustomPathMissing, trimmed);
        }

        // ---- 二级：PATH 扫描（等价 where bash.exe）----
        if (!string.IsNullOrEmpty(pathEnv))
        {
            foreach (var dir in SplitPath(pathEnv))
            {
                if (TryProbe(Path.Combine(dir, "bash.exe"), fileExists, out bashPath))
                {
                    error = null;
                    return true;
                }
            }
        }

        // ---- 三级：Git for Windows 默认安装目录 ----
        foreach (var root in gitInstallRoots)
        {
            if (TryProbe(Path.Combine(root, GitRelativePath), fileExists, out bashPath))
            {
                error = null;
                return true;
            }
        }

        bashPath = string.Empty;
        error = lastError ?? new BashLocateError(BashLocateFailureKind.NotFound, null);
        return false;
    }

    /// <summary>探测单个候选：存在且可访问即命中；探测异常按不存在处理。</summary>
    private static bool TryProbe(string candidate, Func<string, bool> fileExists, out string bashPath)
    {
        bashPath = string.Empty;
        if (string.IsNullOrWhiteSpace(candidate))
        {
            return false;
        }

        try
        {
            if (fileExists(candidate))
            {
                bashPath = Path.GetFullPath(candidate);
                return true;
            }
        }
        catch
        {
            // 权限不足、非法字符等：视为该候选不可用
        }

        return false;
    }

    /// <summary>拆分 PATH；跳过空段，去掉包裹引号（含空格目录）。</summary>
    internal static IEnumerable<string> SplitPath(string pathEnv)
    {
        foreach (var raw in pathEnv.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var dir = raw.Trim('"');
            if (dir.Length > 0)
            {
                yield return dir;
            }
        }
    }

    /// <summary>真实环境的 Git for Windows 候选安装根目录，按常见度排序。</summary>
    private static IReadOnlyList<string> GetGitInstallRoots()
    {
        var roots = new List<string>();

        void AddFromEnv(string variable, string subpath)
        {
            var value = Environment.GetEnvironmentVariable(variable);
            if (!string.IsNullOrWhiteSpace(value))
            {
                roots.Add(Path.Combine(value, subpath));
            }
        }

        AddFromEnv("ProgramFiles", "Git");
        AddFromEnv("ProgramFiles(x86)", "Git");
        AddFromEnv("LocalAppData", "Programs\\Git");

        return roots;
    }
}

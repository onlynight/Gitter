using GitUI.Shell;
using Xunit;

namespace GitUI.Shell.Tests;

/// <summary>
/// S0c：BashLocator 三级回退。
/// 通过注入 PATH 环境、安装根目录与文件存在性断言，不依赖真实机器的 Git 安装状态。
/// </summary>
public sealed class BashLocatorTests
{
    private static readonly Func<string, bool> NothingExists = _ => false;

    private static string JoinPaths(params string[] dirs) => string.Join(";", dirs);

    [Fact]
    public void OverridePath_Exists_WinsOverEverything()
    {
        var found = BashLocator.TryLocate(
            @"D:\Tools\Git\bin\bash.exe",
            pathEnv: JoinPaths(@"C:\Git\bin"),
            gitInstallRoots: new[] { @"C:\Program Files\Git" },
            fileExists: path => path == @"D:\Tools\Git\bin\bash.exe",
            out var bashPath,
            out var error);

        Assert.True(found);
        Assert.Equal(@"D:\Tools\Git\bin\bash.exe", bashPath);
        Assert.Null(error);
    }

    [Fact]
    public void OverridePath_Missing_FallsThroughToPath()
    {
        // 手动路径失效：必须继续回退到 PATH，而不是直接失败
        var found = BashLocator.TryLocate(
            @"E:\gone\bash.exe",
            pathEnv: JoinPaths(@"C:\Git\usr\bin"),
            gitInstallRoots: Array.Empty<string>(),
            fileExists: path => path == @"C:\Git\usr\bin\bash.exe",
            out var bashPath,
            out var error);

        Assert.True(found);
        Assert.Equal(@"C:\Git\usr\bin\bash.exe", bashPath);
        Assert.Null(error);
    }

    [Fact]
    public void OverridePath_WithQuotesAndSpaces_IsHandled()
    {
        // 含空格路径（Program Files 场景）+ 用户复制来的引号包裹
        var found = BashLocator.TryLocate(
            "\"C:\\Program Files\\Git\\bin\\bash.exe\"",
            pathEnv: null,
            gitInstallRoots: Array.Empty<string>(),
            fileExists: path => path == @"C:\Program Files\Git\bin\bash.exe",
            out var bashPath,
            out _);

        Assert.True(found);
        Assert.Equal(@"C:\Program Files\Git\bin\bash.exe", bashPath);
    }

    [Fact]
    public void PathEnv_ContainsBash_FindsIt()
    {
        // PATH 里有（等价 where bash.exe 命中）
        var found = BashLocator.TryLocate(
            null,
            pathEnv: JoinPaths(@"C:\Windows\system32", @"C:\Git\bin", @"C:\other"),
            gitInstallRoots: Array.Empty<string>(),
            fileExists: path => path == @"C:\Git\bin\bash.exe",
            out var bashPath,
            out var error);

        Assert.True(found);
        Assert.Equal(@"C:\Git\bin\bash.exe", bashPath);
        Assert.Null(error);
    }

    [Fact]
    public void PathEnv_FirstMatchWins()
    {
        var found = BashLocator.TryLocate(
            null,
            pathEnv: JoinPaths(@"C:\first", @"C:\second"),
            gitInstallRoots: Array.Empty<string>(),
            fileExists: path => path.EndsWith("bash.exe", StringComparison.OrdinalIgnoreCase),
            out var bashPath,
            out _);

        Assert.True(found);
        Assert.Equal(@"C:\first\bash.exe", bashPath);
    }

    [Fact]
    public void PathEnv_QuotedDirectoryWithSpaces_IsScanned()
    {
        var found = BashLocator.TryLocate(
            null,
            pathEnv: "\"C:\\Program Files\\Git\\bin\";C:\\tail",
            gitInstallRoots: Array.Empty<string>(),
            fileExists: path => path == @"C:\Program Files\Git\bin\bash.exe",
            out var bashPath,
            out _);

        Assert.True(found);
        Assert.Equal(@"C:\Program Files\Git\bin\bash.exe", bashPath);
    }

    [Fact]
    public void InstallRoot_FoundWhenPathAndOverrideMiss()
    {
        var found = BashLocator.TryLocate(
            null,
            pathEnv: JoinPaths(@"C:\Windows\system32"),
            gitInstallRoots: new[] { @"C:\Program Files\Git" },
            fileExists: path => path == @"C:\Program Files\Git\bin\bash.exe",
            out var bashPath,
            out _);

        Assert.True(found);
        Assert.Equal(@"C:\Program Files\Git\bin\bash.exe", bashPath);
    }

    [Fact]
    public void InstallRoot_SecondCandidateIsTried()
    {
        var found = BashLocator.TryLocate(
            null,
            pathEnv: null,
            gitInstallRoots: new[] { @"C:\missing\Git", @"C:\Program Files (x86)\Git" },
            fileExists: path => path == @"C:\Program Files (x86)\Git\bin\bash.exe",
            out var bashPath,
            out _);

        Assert.True(found);
        Assert.Equal(@"C:\Program Files (x86)\Git\bin\bash.exe", bashPath);
    }

    [Fact]
    public void NothingExists_ReportsErrorAndFails()
    {
        var found = BashLocator.TryLocate(
            null,
            pathEnv: JoinPaths(@"C:\Windows\system32"),
            gitInstallRoots: new[] { @"C:\Program Files\Git" },
            fileExists: NothingExists,
            out var bashPath,
            out var error);

        Assert.False(found);
        Assert.Equal(string.Empty, bashPath);
        Assert.NotNull(error);
        Assert.Contains("bash.exe", error, StringComparison.Ordinal);
    }

    [Fact]
    public void OverrideMissingAndNothingElse_ReportsManualPathInError()
    {
        var found = BashLocator.TryLocate(
            @"E:\custom\bash.exe",
            pathEnv: null,
            gitInstallRoots: Array.Empty<string>(),
            fileExists: NothingExists,
            out _,
            out var error);

        Assert.False(found);
        Assert.NotNull(error);
        Assert.Contains(@"E:\custom\bash.exe", error, StringComparison.Ordinal);
    }

    [Fact]
    public void FileExistsThrowing_IsTreatedAsMissing()
    {
        // 权限不足等 IO 异常：吞掉并继续回退
        var found = BashLocator.TryLocate(
            null,
            pathEnv: JoinPaths(@"C:\denied", @"C:\Git\bin"),
            gitInstallRoots: Array.Empty<string>(),
            fileExists: path =>
            {
                if (path.StartsWith(@"C:\denied", StringComparison.OrdinalIgnoreCase))
                {
                    throw new UnauthorizedAccessException("denied");
                }

                return path == @"C:\Git\bin\bash.exe";
            },
            out var bashPath,
            out _);

        Assert.True(found);
        Assert.Equal(@"C:\Git\bin\bash.exe", bashPath);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void EmptyOverride_SkipsToNextLevel(string? overridePath)
    {
        var found = BashLocator.TryLocate(
            overridePath,
            pathEnv: JoinPaths(@"C:\Git\bin"),
            gitInstallRoots: Array.Empty<string>(),
            fileExists: path => path == @"C:\Git\bin\bash.exe",
            out var bashPath,
            out _);

        Assert.True(found);
        Assert.Equal(@"C:\Git\bin\bash.exe", bashPath);
    }

    [Fact]
    public void SplitPath_HandlesEmptySegmentsAndQuotes()
    {
        var dirs = BashLocator.SplitPath("\"C:\\dir one\";;C:\\dir2; ;C:\\dir3").ToList();

        Assert.Equal(new[] { @"C:\dir one", @"C:\dir2", @"C:\dir3" }, dirs);
    }
}

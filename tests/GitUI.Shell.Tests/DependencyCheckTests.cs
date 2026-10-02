using Xunit;

namespace GitUI.Shell.Tests;

/// <summary>
/// design.md §4.7.5 依赖约束：GitUI.Shell 不得引用 libgit2sharp。
/// 读取 csproj 源文本断言，保证约束在 CI 中可自动执行。
/// </summary>
public sealed class DependencyCheckTests
{
    [Fact]
    public void ShellProject_DoesNotReferenceLibGit2Sharp()
    {
        var csprojPath = FindRepoFile(Path.Combine("src", "GitUI.Shell", "GitUI.Shell.csproj"));

        Assert.True(File.Exists(csprojPath), $"找不到 {csprojPath}");
        var text = StripXmlComments(File.ReadAllText(csprojPath));
        Assert.False(
            text.Contains("LibGit2Sharp", StringComparison.OrdinalIgnoreCase),
            "GitUI.Shell 不允许引用 LibGit2Sharp（design.md §4.7.5 依赖约束）");
        Assert.False(
            text.Contains("GitUI.Core", StringComparison.OrdinalIgnoreCase),
            "GitUI.Shell 不允许引用 GitUI.Core，保持 Shell 层独立");
    }

    /// <summary>去掉 XML 注释，避免说明文字里的依赖名误触发断言。</summary>
    private static string StripXmlComments(string text)
    {
        var start = text.IndexOf("<!--", StringComparison.Ordinal);
        while (start >= 0)
        {
            var end = text.IndexOf("-->", start, StringComparison.Ordinal);
            if (end < 0)
            {
                return text[..start];
            }

            text = text[..start] + text[(end + 3)..];
            start = text.IndexOf("<!--", StringComparison.Ordinal);
        }

        return text;
    }

    /// <summary>从测试输出目录向上找到仓库根（含 GitUI.sln 的目录）。</summary>
    private static string FindRepoFile(string relativePath)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "GitUI.sln")))
        {
            dir = dir.Parent;
        }

        Assert.NotNull(dir);
        return Path.Combine(dir.FullName, relativePath);
    }
}

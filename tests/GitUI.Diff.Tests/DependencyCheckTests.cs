using Xunit;

namespace GitUI.Diff.Tests;

/// <summary>
/// design.md §8 S2 依赖约束：GitUI.Diff 是纯算法层——
/// 不引用 libgit2sharp，也不引用 GitUI.Git。读取 csproj 源文本断言。
/// </summary>
public sealed class DependencyCheckTests
{
    [Fact]
    public void DiffProject_DoesNotReferenceLibGit2SharpOrGitLayer()
    {
        var csprojPath = FindRepoFile(Path.Combine("src", "GitUI.Diff", "GitUI.Diff.csproj"));

        Assert.True(File.Exists(csprojPath), $"找不到 {csprojPath}");
        var text = StripXmlComments(File.ReadAllText(csprojPath));
        Assert.False(
            text.Contains("LibGit2Sharp", StringComparison.OrdinalIgnoreCase),
            "GitUI.Diff 不允许引用 LibGit2Sharp（diff 引擎必须无 git 依赖，design.md §8 S2）");
        Assert.False(
            text.Contains("GitUI.Git", StringComparison.OrdinalIgnoreCase),
            "GitUI.Diff 不允许引用 GitUI.Git（分层：Diff 是 Git 的下游纯算法层）");
        Assert.False(
            text.Contains("GitUI.App", StringComparison.OrdinalIgnoreCase),
            "GitUI.Diff 不允许引用 GitUI.App");
    }

    private static string StripXmlComments(string text)
    {
        var start = text.IndexOf("<!--", StringComparison.Ordinal);
        while (start >= 0)
        {
            var end = text.IndexOf("-->", start, StringComparison.Ordinal);
            if (end < 0) return text[..start];
            text = text[..start] + text[(end + 3)..];
            start = text.IndexOf("<!--", StringComparison.Ordinal);
        }
        return text;
    }

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

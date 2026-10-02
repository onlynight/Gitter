using GitUI.Core.Models;
using Xunit;

namespace GitUI.Git.Tests;

/// <summary>
/// design.md §9 风险表 S2 项：中文路径与内容在 diff 链路中不被转义/乱码。
/// fixture 仓库已设置 core.quotepath=false（GitFixtureBuilder）。
/// </summary>
public sealed class UnicodePathDiffTests : IDisposable
{
    private readonly TestRepo _repo = new();
    public void Dispose() => _repo.Dispose();

    [Fact]
    public void GetCommitDiff_ChinesePathAndContent_Preserved()
    {
        _repo.Builder.Commit("base", ("base.txt", "base\n"));
        var sha = _repo.Builder.Commit("中文提交", ("docs/说明.txt", "中文内容第一行\nsecond\n"));

        var diffs = _repo.Service.GetCommitDiff(_repo.WorkDir, sha);

        var entry = Assert.Single(diffs);
        Assert.Equal("docs/说明.txt", entry.Path);
        Assert.True(entry.IsNew);
        var hunk = Assert.Single(entry.Hunks);
        Assert.Contains("+中文内容第一行", hunk.NewLines);
    }

    [Fact]
    public void GetFileDiff_ChineseContent_Modification()
    {
        var sha1 = _repo.Builder.Commit("第一笔", ("文档/笔记.txt", "第一版内容\n"));
        var sha2 = _repo.Builder.Commit("第二笔", ("文档/笔记.txt", "第二版内容\n"));

        var result = _repo.Service.GetFileDiff(_repo.WorkDir, "文档/笔记.txt", sha1, sha2);

        Assert.False(result.IsBinary);
        Assert.Equal(1, result.AddedLines);
        Assert.Equal(1, result.DeletedLines);
        var hunk = Assert.Single(result.Hunks);
        Assert.Contains("-第一版内容", hunk.OldLines);
        Assert.Contains("+第二版内容", hunk.NewLines);
    }

    [Fact]
    public void ComputeDiff_ChineseText_HunkPrefixesCorrect()
    {
        var hunks = _repo.Service.ComputeDiff("中文旧行\n保留行\n", "中文新行\n保留行\n");
        var h = Assert.Single(hunks);
        Assert.Equal('-' + "中文旧行", h.OldLines.Single(l => l.StartsWith('-')));
        Assert.Equal('+' + "中文新行", h.NewLines.Single(l => l.StartsWith('+')));
    }
}

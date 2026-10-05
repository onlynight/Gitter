using GitUI.Core.Models;
using Xunit;

namespace GitUI.Core.Tests.Models;

public sealed class CommitTrailersTests
{
    [Fact]
    public void Read_ParsesTrailersFromLastBlock()
    {
        var message = "feat: add thing\n\nbody line\n\nAssisted-by: deepseek-agent\nGitter-Session: abc-123\n";
        var meta = CommitTrailers.Read(message);

        Assert.True(meta.IsAi);
        Assert.Equal("deepseek-agent", meta.AssistedBy);
        Assert.Equal("abc-123", meta.SessionId);
    }

    [Fact]
    public void Read_AssistedByOnly()
    {
        var meta = CommitTrailers.Read("fix: x\n\nAssisted-by: claude-code\n");
        Assert.Equal("claude-code", meta.AssistedBy);
        Assert.Null(meta.SessionId);
    }

    [Fact]
    public void Read_TrailerInMiddle_IsIgnored()
    {
        // trailer 必须在最后一个段落；正文里出现的不算
        var meta = CommitTrailers.Read("feat: x\n\nAssisted-by: fake\n\nreal body");
        Assert.False(meta.IsAi);
    }

    [Fact]
    public void Read_HumanCommit_ReturnsNone()
    {
        Assert.False(CommitTrailers.Read("feat: human work\n\nbody").IsAi);
        Assert.False(CommitTrailers.Read("").IsAi);
        Assert.False(CommitTrailers.Read(null).IsAi);
    }
}

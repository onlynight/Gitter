using System.Collections.Immutable;
using GitUI.Core.Models;
using Xunit;

namespace GitUI.Core.Tests.Models;

public sealed class CommitNodeTests
{
    private static CommitNode Node(ImmutableArray<string> parents) => new(
        new string('a', 40),
        "aaaaaaa",
        "feat: something\n\nbody",
        "feat: something",
        "Alice",
        "alice@example.com",
        DateTimeOffset.UnixEpoch,
        "Alice",
        DateTimeOffset.UnixEpoch,
        parents,
        new string('b', 40),
        ImmutableArray.Create("main"),
        ImmutableArray<string>.Empty);

    [Fact]
    public void RootCommit_IsNotMerge_AndIsRoot()
    {
        var n = Node(CommitNode.NoParents);
        Assert.False(n.IsMerge);
        Assert.True(n.IsRoot);
    }

    [Fact]
    public void NormalCommit_HasSingleParent_NotMerge()
    {
        var n = Node(ImmutableArray.Create("p1"));
        Assert.False(n.IsMerge);
        Assert.False(n.IsRoot);
    }

    [Fact]
    public void MergeCommit_IsMerge()
    {
        var n = Node(ImmutableArray.Create("p1", "p2"));
        Assert.True(n.IsMerge);
        Assert.Equal(2, n.ParentShas.Length);
    }

    [Fact]
    public void OctopusMerge_IsMerge_WithThreeParents()
    {
        var n = Node(ImmutableArray.Create("p1", "p2", "p3"));
        Assert.True(n.IsMerge);
        Assert.Equal(3, n.ParentShas.Length);
    }

    [Fact]
    public void Equality_ValueBased_ByShaAndParents()
    {
        var a = Node(ImmutableArray.Create("p1"));
        // 通过 builder 构造，底层引用与 ImmutableArray.Create 不同，但内容一致
        var builder = ImmutableArray.CreateBuilder<string>(1);
        builder.Add("p1");
        var b = Node(builder.MoveToImmutable());
        var c = Node(ImmutableArray.Create("p2"));
        Assert.True(a.Equals(b));
        Assert.Equal(a.GetHashCode(), b.GetHashCode());
        Assert.False(a.Equals(c));
    }
}

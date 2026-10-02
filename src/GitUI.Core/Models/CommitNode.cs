using System.Collections.Immutable;

namespace GitUI.Core.Models;

/// <summary>
/// 一条提交的历史节点。不可变。
/// </summary>
public sealed class CommitNode : IEquatable<CommitNode>
{
    public string Sha { get; }
    public string ShortSha { get; }
    public string Message { get; }
    public string Subject { get; }
    public string Author { get; }
    public string AuthorEmail { get; }
    public DateTimeOffset AuthorDate { get; }
    public string Committer { get; }
    public DateTimeOffset CommitterDate { get; }
    public ImmutableArray<string> ParentShas { get; }
    public string TreeSha { get; }
    public ImmutableArray<string> BranchNames { get; }
    public ImmutableArray<string> TagNames { get; }

    /// <param name="parentShas">父提交 SHA 列表。空表示根提交，>1 表示合并提交。</param>
    public CommitNode(
        string sha,
        string shortSha,
        string message,
        string subject,
        string author,
        string authorEmail,
        DateTimeOffset authorDate,
        string committer,
        DateTimeOffset committerDate,
        ImmutableArray<string> parentShas,
        string treeSha,
        ImmutableArray<string> branchNames,
        ImmutableArray<string> tagNames)
    {
        Sha = sha ?? throw new ArgumentNullException(nameof(sha));
        ShortSha = shortSha ?? throw new ArgumentNullException(nameof(shortSha));
        Message = message ?? string.Empty;
        Subject = subject ?? string.Empty;
        Author = author ?? string.Empty;
        AuthorEmail = authorEmail ?? string.Empty;
        AuthorDate = authorDate;
        Committer = committer ?? string.Empty;
        CommitterDate = committerDate;
        TreeSha = treeSha ?? throw new ArgumentNullException(nameof(treeSha));
        if (parentShas.IsDefault) throw new ArgumentException("ParentShas must not be default", nameof(parentShas));
        if (branchNames.IsDefault) throw new ArgumentException("BranchNames must not be default", nameof(branchNames));
        if (tagNames.IsDefault) throw new ArgumentException("TagNames must not be default", nameof(tagNames));
        ParentShas = parentShas;
        BranchNames = branchNames;
        TagNames = tagNames;
    }

    public bool IsMerge => ParentShas.Length > 1;
    public bool IsRoot => ParentShas.IsDefaultOrEmpty;

    /// <summary>无父提交的默认值。</summary>
    public static ImmutableArray<string> NoParents { get; } = ImmutableArray.Create<string>();

    /// <summary>
    /// 按内容比较，而不是 <see cref="ImmutableArray{T}"/> 的引用/结构相等性。
    /// 否则 <c>ImmutableArray.Create("p1")</c> 与 <c>ImmutableArray.CreateBuilder</c> 产出的等值数组
    /// 会判为不等，让基于内容的去重失效。
    /// </summary>
    public bool Equals(CommitNode? other)
    {
        if (other is null) return false;
        if (ReferenceEquals(this, other)) return true;
        return Sha == other.Sha
            && ShortSha == other.ShortSha
            && Message == other.Message
            && Subject == other.Subject
            && Author == other.Author
            && AuthorEmail == other.AuthorEmail
            && AuthorDate == other.AuthorDate
            && Committer == other.Committer
            && CommitterDate == other.CommitterDate
            && ParentShas.SequenceEqual(other.ParentShas)
            && TreeSha == other.TreeSha
            && BranchNames.SequenceEqual(other.BranchNames)
            && TagNames.SequenceEqual(other.TagNames);
    }

    public override bool Equals(object? obj) => Equals(obj as CommitNode);

    public override int GetHashCode() =>
        HashCode.Combine(
            Sha, Message, Author, AuthorEmail, AuthorDate, CommitterDate, TreeSha, ParentShas.Length);
}

using GitUI.Core.Services;
using GitUI.Git;
using Xunit;

namespace GitUI.Git.Tests;

/// <summary>
/// 每个测试独占一个临时目录 fixture，避免相互污染。
/// </summary>
public sealed class TestRepo : IDisposable
{
    public GitFixtureBuilder Builder { get; }
    public LibGit2RepositoryService Service { get; }
    public string WorkDir => Builder.WorkDir;
    public IRepositoryService IRepositoryService => Service;

    public TestRepo()
    {
        var dir = Path.Combine(Path.GetTempPath(), "gitui-test-" + Guid.NewGuid().ToString("N"));
        Builder = GitFixtureBuilder.Init(dir, "main");
        Service = new LibGit2RepositoryService();
    }

    public void Dispose() => Builder.Dispose();
}

/// <summary>
/// xUnit 集，避免每个测试类都自己写临时目录脚手架。
/// </summary>
public sealed class FixtureSet : IDisposable
{
    public readonly TestRepo Repo = new();
    public void Dispose() => Repo.Dispose();
}

/// <summary>
/// 20 拓扑参数化测试的共享 fixture。
/// </summary>
public sealed class TopologyFixture : IDisposable
{
    public IReadOnlyList<TopologySpec> Specs { get; } = RandomizedFixtureGenerator.Generate20();
    public void Dispose() { }
}

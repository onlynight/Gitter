using System.Diagnostics;
using System.Text;
using GitUI.Git;
using Xunit;

namespace GitUI.Git.Tests;

/// <summary>
/// 回归（变更页空白根因）：autocrlf=true 的仓库里 git diff 会向 stderr 刷
/// "LF will be replaced by CRLF" 警告，每个改动文件约 100 字节；改动文件一多
/// （约 60+，> 4KB 管道缓冲区）先读 stdout 再读 stderr 的串行排空就会与 git 互锁：
/// git 阻塞在写 stderr，本方阻塞在读 stdout。表现为 GetNumStat/GetWorktreePatch
/// 永不返回，ChangesViewModel.LoadCoreAsync 挂起，变更页三层列表永远空白。
/// RunGit 改为并发排空后必须正常返回。
/// </summary>
public sealed class RunGitWarningFloodTests : IDisposable
{
    private readonly TestRepo _repo = new();
    private LibGit2RepositoryService Svc => _repo.Service;

    public void Dispose() => _repo.Dispose();

    private const int FileCount = 120; // 120 × ~100B 警告 ≈ 12KB，跨环境稳超 4KB 缓冲

    [Fact]
    public async Task GetNumStat_AutocrlfWarningFlood_ReturnsWithoutDeadlock()
    {
        // base 提交在 autocrlf=false 下完成，blob 保持 LF；随后翻成 true 触发警告
        _repo.Builder.Commit("base", Enumerable.Range(0, FileCount)
            .Select(i => ($"f{i}.txt", "line\n"))
            .ToArray());
        _repo.Builder.RunGit("config", "core.autocrlf", "true");
        for (var i = 0; i < FileCount; i++)
            _repo.Builder.Write($"f{i}.txt", $"line-{i}\nmore\n");

        // 前置条件自检：确认警告洪水真实存在（并发排空方式读取，自身不会死锁）
        var (stdout, stderr) = RunGitDrainConcurrently("diff", "--numstat");
        Assert.True(stderr.Length > 4096,
            $"测试前提失效：stderr 仅 {stderr.Length} 字节（需 >4KB 才能复现管道死锁）。stdout 行数：{stdout.Split('\n').Length}");

        // 被测路径：60s 内完不成即判定死锁复发（而非无限挂起测试进程）
        var task = Task.Run(() => Svc.GetNumStat(_repo.WorkDir, staged: false));
        var done = await Task.WhenAny(task, Task.Delay(TimeSpan.FromSeconds(60)));
        Assert.Same(task, done);
        Assert.Equal(FileCount, task.Result.Count);
    }

    [Fact]
    public async Task GetWorktreePatch_AutocrlfWarningFlood_ReturnsPatch()
    {
        _repo.Builder.Commit("base", ("f.txt", "line\n"));
        _repo.Builder.RunGit("config", "core.autocrlf", "true");
        // 120 个改动文件让警告超管道缓冲，但只取其中一个文件的 patch
        for (var i = 0; i < FileCount; i++)
            _repo.Builder.Write(i == 0 ? "f.txt" : $"f{i}.txt", $"line-{i}\nmore\n");

        var task = Task.Run(() => Svc.GetWorktreePatch(_repo.WorkDir, "f.txt"));
        var done = await Task.WhenAny(task, Task.Delay(TimeSpan.FromSeconds(60)));
        Assert.Same(task, done);
        Assert.NotNull(task.Result);
        Assert.Contains("line-0", task.Result);
    }

    /// <summary>与 GitFixtureBuilder.Run 相同的环境隔离，但并发排空双管道（自身免死锁）。</summary>
    private (string Stdout, string Stderr) RunGitDrainConcurrently(params string[] args)
    {
        var psi = new ProcessStartInfo("git")
        {
            WorkingDirectory = _repo.WorkDir,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);

        using var process = Process.Start(psi)!;
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        process.WaitForExit(60_000);
        return (stdout.GetAwaiter().GetResult(), stderr.GetAwaiter().GetResult());
    }
}

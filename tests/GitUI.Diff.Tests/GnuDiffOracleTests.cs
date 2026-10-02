using System.Diagnostics;
using System.Text;
using GitUI.Core.Services;
using GitUI.Diff;
using Xunit;
using Engine = GitUI.Diff.MyersDiffEngine;

namespace GitUI.Diff.Tests;

/// <summary>
/// design.md §8 S2 验收项：与 GNU diff -u 输出对比（oracle）。
/// 块划分允许不同（设计明确允许），但必须满足：
///   1. 引擎 hunk 应用到旧文本后与 GNU diff 的目标文本一致（即精确还原新文件）；
///   2. 净行数变化（+行数 − 删除行数）与 GNU diff 一致；
///   3. "无差异"判定与 GNU diff 一致。
/// 未找到 diff.exe 时跳过（Git for Windows 自带，正常桌面环境必装）。
/// </summary>
public sealed class GnuDiffOracleTests
{
    private static readonly string? DiffExe = LocateDiff();

    [Fact]
    public void Oracle_IdenticalFiles_BothEmpty()
    {
        if (DiffExe is null) return;
        var text = "same\ncontent\nhere\n";
        var gnu = RunDiff(text, text);
        var engine = Engine.Instance.ComputeHunks(text, text);
        Assert.Empty(HunkAssert.ParseUnifiedDiff(gnu));
        Assert.Empty(engine);
    }

    [Fact]
    public void Oracle_SingleChange_SingleHunkOnBothSides()
    {
        if (DiffExe is null) return;
        var old = "a\nb\nc\nd\ne\nf\ng\nh\n";
        var newT = "a\nb\nc\nX\ne\nf\ng\nh\n";
        var gnu = HunkAssert.ParseUnifiedDiff(RunDiff(old, newT));
        var engine = Engine.Instance.ComputeHunks(old, newT);
        Assert.Single(gnu);
        Assert.Single(engine);
        HunkAssert.AppliesCleanly(old, newT, engine);
        Assert.Equal(NetChange(gnu), NetChange(engine));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(5)]
    [InlineData(6)]
    [InlineData(7)]
    [InlineData(8)]
    public void Oracle_RandomMutations_ContentEquivalence(int seed)
    {
        if (DiffExe is null) return;
        var (oldText, newText) = Mutate(seed);

        var gnuText = RunDiff(oldText, newText);
        var gnu = HunkAssert.ParseUnifiedDiff(gnuText);
        var engine = Engine.Instance.ComputeHunks(oldText, newText);

        // 1. GNU 无差异 ⟺ 引擎无差异
        Assert.True(gnu.Count == 0 == (engine.Count == 0),
            $"无差异判定不一致：gnu={gnu.Count} hunks, engine={engine.Count} hunks");

        // 2. 引擎输出可还原新文本（内容等价的核心性质）
        HunkAssert.AppliesCleanly(oldText, newText, engine);

        // 3. 净行数变化一致
        Assert.Equal(NetChange(gnu), NetChange(engine));
    }

    private static int NetChange(IReadOnlyList<GitUI.Core.Models.DiffHunk> hunks)
        => HunkAssert.SumAdded(hunks) - HunkAssert.SumDeleted(hunks);

    /// <summary>确定性随机文件对：小词表保证大量重复行 + 多种突变类型。</summary>
    private static (string Old, string New) Mutate(int seed)
    {
        string[] vocab = { "alpha", "beta", "gamma", "delta", "epsilon", "return", "int x;", "}", "{", "中文行" };
        var rng = new Random(seed);
        int n = rng.Next(20, 80);
        var lines = new List<string>();
        for (int i = 0; i < n; i++) lines.Add(vocab[rng.Next(vocab.Length)]);

        var mutated = new List<string>(lines);
        int mutations = rng.Next(1, 8);
        for (int m = 0; m < mutations; m++)
        {
            if (mutated.Count == 0) break;
            int pos = rng.Next(mutated.Count + 1);
            switch (rng.Next(4))
            {
                case 0: // 替换
                    if (pos < mutated.Count) mutated[pos] = vocab[rng.Next(vocab.Length)];
                    break;
                case 1: // 删除
                    if (pos < mutated.Count) mutated.RemoveAt(pos);
                    break;
                case 2: // 插入
                    mutated.Insert(pos, vocab[rng.Next(vocab.Length)]);
                    break;
                case 3: // 交换相邻两行
                    if (mutated.Count >= 2 && pos < mutated.Count - 1)
                        (mutated[pos], mutated[pos + 1]) = (mutated[pos + 1], mutated[pos]);
                    break;
            }
        }

        return (string.Join("\n", lines) + "\n", string.Join("\n", mutated) + "\n");
    }

    private static string RunDiff(string oldText, string newText)
    {
        var dir = Path.Combine(Path.GetTempPath(), "gitui-oracle-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            var oldFile = Path.Combine(dir, "old.txt");
            var newFile = Path.Combine(dir, "new.txt");
            File.WriteAllText(oldFile, oldText, new EncodingUtf8NoBom());
            File.WriteAllText(newFile, newText, new EncodingUtf8NoBom());

            var psi = new ProcessStartInfo
            {
                FileName = DiffExe!,
                ArgumentList = { "-u", oldFile, newFile },
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                StandardOutputEncoding = Encoding.UTF8,
            };
            using var p = Process.Start(psi)!;
            var stdout = p.StandardOutput.ReadToEnd();
            p.WaitForExit(10_000);
            return stdout;
        }
        finally
        {
            try { Directory.Delete(dir, recursive: true); } catch { /* 清理失败不影响测试 */ }
        }
    }

    private static string? LocateDiff()
    {
        var pathEnv = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        foreach (var dir in pathEnv.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var candidate = Path.Combine(dir, "diff.exe");
            if (File.Exists(candidate)) return candidate;
        }

        string[] guesses =
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Git", "usr", "bin", "diff.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Git", "usr", "bin", "diff.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Git", "usr", "bin", "diff.exe"),
        };
        return guesses.FirstOrDefault(File.Exists);
    }

    /// <summary>diff.exe 对比要求两侧字节一致，写入必须无 BOM。</summary>
    private sealed class EncodingUtf8NoBom : UTF8Encoding
    {
        public EncodingUtf8NoBom() : base(encoderShouldEmitUTF8Identifier: false) { }
    }
}

using System.Diagnostics;
using System.IO;
using GitUI.Diff;
using Xunit;
using Engine = GitUI.Diff.MyersDiffEngine;

namespace GitUI.Diff.Tests;

/// <summary>
/// S2 性能基准（docs/design.md §8 S2：20k 行 diff 计算 < 300ms）。
/// [Trait("Category","Perf")] 供 verify-s2.ps1 分组，数值写入临时日志。
/// </summary>
public sealed class DiffPerformanceTests
{
    private static readonly string LogPath = Path.Combine(Path.GetTempPath(), "gitui-diff-perf.log");

    private static void Log(string line)
    {
        try { File.AppendAllText(LogPath, line + Environment.NewLine); }
        catch { /* 日志不可用时忽略 */ }
    }

    private static string BuildFile(int lines, Func<int, string> line)
        => string.Concat(Enumerable.Range(0, lines).Select(i => line(i) + "\n"));

    [Fact]
    [Trait("Category", "Perf")]
    public void LineDiff_20kLines_ScatteredChanges_Under300Ms()
    {
        // 100 处分散单行修改：唯一行锚点分割后是 100 个微小窗口
        var oldText = BuildFile(20_000, i => $"line {i} content {i % 7}");
        var oldLines = oldText.Split('\n');
        for (int i = 0; i < 20_000; i += 200) oldLines[i] = $"CHANGED {i}";
        var newText = string.Join('\n', oldLines);

        var engine = Engine.Instance;
        engine.ComputeHunks(oldText, newText); // 预热（JIT/字典扩容）

        var sw = Stopwatch.StartNew();
        var hunks = engine.ComputeHunks(oldText, newText);
        sw.Stop();
        Log($"diff 20k scattered(100 changes): {sw.ElapsedMilliseconds} ms, hunks={hunks.Count}");

        Assert.Equal(100, hunks.Count);
        HunkAssert.AppliesCleanly(oldText, newText, hunks);
        Assert.True(sw.ElapsedMilliseconds < 300, $"20k 行分散修改 diff 用了 {sw.ElapsedMilliseconds} ms，超过 300ms 阈值");
    }

    [Fact]
    [Trait("Category", "Perf")]
    public void LineDiff_20kLines_BigMiddleReplace_Under300Ms()
    {
        // 中间整块替换（500 行 → 600 行）：锚点界定出 ~1100 行窗口走 Myers
        var left = BuildFile(9_750, i => $"left {i}");
        var right = BuildFile(9_750, i => $"right {i}");
        var oldText = left + BuildFile(500, i => $"old block {i}") + right;
        var newText = left + BuildFile(600, i => $"new block {i}") + right;

        var engine = Engine.Instance;
        engine.ComputeHunks(oldText, newText);

        var sw = Stopwatch.StartNew();
        var hunks = engine.ComputeHunks(oldText, newText);
        sw.Stop();
        Log($"diff 20k big-replace: {sw.ElapsedMilliseconds} ms, hunks={hunks.Count}");

        Assert.Equal(500, HunkAssert.SumDeleted(hunks));
        Assert.Equal(600, HunkAssert.SumAdded(hunks));
        HunkAssert.AppliesCleanly(oldText, newText, hunks);
        Assert.True(sw.ElapsedMilliseconds < 300, $"20k 行整块替换 diff 用了 {sw.ElapsedMilliseconds} ms，超过 300ms 阈值");
    }

    [Fact]
    [Trait("Category", "Perf")]
    public void LineDiff_PathologicalAllDifferent_CompletesQuickly()
    {
        // 完全不同的 5k×5k：预算耗尽退化为整段替换，必须快速终止且结果正确
        var oldText = BuildFile(5_000, i => $"old {i} \u4e2d\u6587");
        var newText = BuildFile(5_000, i => $"new {i} \u6587\u5b57");

        var sw = Stopwatch.StartNew();
        var hunks = Engine.Instance.ComputeHunks(oldText, newText);
        sw.Stop();
        Log($"diff 5k all-different (budget fallback): {sw.ElapsedMilliseconds} ms, hunks={hunks.Count}");

        HunkAssert.AppliesCleanly(oldText, newText, hunks);
        Assert.Equal(5_000, HunkAssert.SumDeleted(hunks));
        Assert.Equal(5_000, HunkAssert.SumAdded(hunks));
        Assert.True(sw.ElapsedMilliseconds < 2_000, $"全异 5k 行 diff 用了 {sw.ElapsedMilliseconds} ms");
    }

    [Fact]
    [Trait("Category", "Perf")]
    public void LineDiff_Identical20k_FastPath()
    {
        var text = BuildFile(20_000, i => $"same {i}");
        var sw = Stopwatch.StartNew();
        var hunks = Engine.Instance.ComputeHunks(text, text);
        sw.Stop();
        Log($"diff 20k identical: {sw.ElapsedMilliseconds} ms");

        Assert.Empty(hunks);
        Assert.True(sw.ElapsedMilliseconds < 300, $"20k 行相同文本判等用了 {sw.ElapsedMilliseconds} ms");
    }
}

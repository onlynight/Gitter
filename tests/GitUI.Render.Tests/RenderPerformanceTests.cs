using Xunit;
using GitUI.Core.Models;
using GitUI.Diff;
using GitUI.Core.Services;
using GitUI.Diff.Render;

namespace GitUI.Render.Tests;

/// <summary>
/// S3 性能基准（design.md §8-S3）：10k 行 diff 首帧 < 200ms；滚动帧预算 33ms（≥30fps）。
/// 本基准覆盖 Headless 可测的部分（行模型 + 字级惰性计算 + 布局）；
/// Win2D 绘制约 50 个可视行的矩形/文本在 GPU/D2D 侧，量级远小于管线。
/// [Trait("Category","Perf")] 供 verify-s3.ps1 分组，数值写入临时日志。
/// </summary>
public class RenderPerformanceTests
{
    private static readonly DiffMetrics M = DiffMetrics.Default;
    private static readonly string LogPath = Path.Combine(Path.GetTempPath(), "gitui-render-perf.log");

    private static void Log(string line)
    {
        try { File.AppendAllText(LogPath, line + Environment.NewLine); }
        catch { /* 日志不可用时忽略 */ }
    }

    /// <summary>10k 行内容、每 8 行一处修改（≈1240 个 hunk，产出 ≈10k 渲染行，对齐设计"10k 行 diff"）。</summary>
    private static (DiffRenderModel Model, int Rows) BuildModel(bool sideBySide)
    {
        var lines = new List<string>(10_000);
        for (int i = 0; i < 10_000; i++) lines.Add($"line {i:00000} content");

        IDiffEngine engine = MyersDiffEngine.Instance;
        var oldText = string.Join("\n", lines);
        var changed = lines.ToArray();
        // 相邻修改相距 8 行 > 2×context，hunk 不合并，渲染行数与内容行数同量级
        for (int i = 100; i < 10_000; i += 8) changed[i] = $"CHANGED {i:00000} content";
        var newText = string.Join("\n", changed);

        var hunks = engine.ComputeHunks(oldText, newText, new DiffOptions { ContextLines = 3 });
        var model = new DiffRenderModel(hunks, sideBySide: sideBySide);
        return (model, model.Rows.Count);
    }

    [Fact]
    [Trait("Category", "Perf")]
    public void FirstFrame_10kLineDiff_Under200ms()
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var (model, rows) = BuildModel(sideBySide: true);
        var buildMs = sw.ElapsedMilliseconds;

        // 首帧：可视区字级差异 + 布局
        var viewport = new DiffViewport(1200, 600, 0);
        model.EnsureWordDiff(0, 40);
        var frame = DiffLayoutEngine.Layout(model, sideBySide: true, M, viewport);
        sw.Stop();

        Log($"render first-frame 10k rows({model.Rows.Count}): model {buildMs} ms + word/layout {sw.ElapsedMilliseconds - buildMs} ms = {sw.ElapsedMilliseconds} ms");

        Assert.True(rows > 9_000, $"行数意外偏少: {rows}");
        Assert.NotEmpty(frame.Commands);
        Assert.True(sw.ElapsedMilliseconds < 200,
            $"首帧超时: 构建 {buildMs}ms + 字级/布局 {sw.ElapsedMilliseconds - buildMs}ms = {sw.ElapsedMilliseconds}ms");
    }

    [Fact]
    public void ScrollFrames_10kRows_Budget30fps()
    {
        var (model, rows) = BuildModel(sideBySide: true);
        var viewportHeight = 600.0;
        int visible = (int)Math.Ceiling(viewportHeight / M.LineHeight);

        var maxMs = 0.0;
        var totalMs = 0.0;
        const int frames = 120;
        // 模拟连续滚动（每帧推进半屏，末尾回卷）
        for (int f = 0; f < frames; f++)
        {
            int firstRow = (int)((f * visible / 2.0) % Math.Max(1, rows - visible));
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var viewport = new DiffViewport(1200, viewportHeight, firstRow);
            var (_, from, last) = DiffLayoutEngine.VisibleRange(rows, M, viewport);
            model.EnsureWordDiff(from, last);
            var frame = DiffLayoutEngine.Layout(model, sideBySide: true, M, viewport);
            var ms = sw.Elapsed.TotalMilliseconds;
            totalMs += ms;
            if (ms > maxMs) maxMs = ms;
            Assert.NotEmpty(frame.Commands);
        }

        var avgMs = totalMs / frames;
        Log($"render scroll 120 frames side-by-side: avg {avgMs:F2} ms, max {maxMs:F2} ms");
        Assert.True(avgMs < 16, $"平均帧 {avgMs:F2}ms 超预算（120 帧滚动模拟）");
        Assert.True(maxMs < 33, $"单帧峰值 {maxMs:F2}ms 超过 30fps 帧预算");
    }

    [Fact]
    public void InlineMode_ScrollFrames_Budget30fps()
    {
        var (model, rows) = BuildModel(sideBySide: false);
        var viewportHeight = 600.0;
        int visible = (int)Math.Ceiling(viewportHeight / M.LineHeight);

        var maxMs = 0.0;
        var totalMs = 0.0;
        const int frames = 60;
        for (int f = 0; f < frames; f++)
        {
            int firstRow = (int)((f * visible) % Math.Max(1, rows - visible));
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var viewport = new DiffViewport(1200, viewportHeight, firstRow);
            var (_, from, last) = DiffLayoutEngine.VisibleRange(rows, M, viewport);
            model.EnsureWordDiff(from, last);
            DiffLayoutEngine.Layout(model, sideBySide: false, M, viewport);
            var ms = sw.Elapsed.TotalMilliseconds;
            totalMs += ms;
            if (ms > maxMs) maxMs = ms;
        }

        Assert.True(totalMs / frames < 16, $"内联平均帧 {totalMs / frames:F2}ms 超预算");
        Assert.True(maxMs < 33, $"内联单帧峰值 {maxMs:F2}ms 超过 30fps 帧预算");
    }

    [Fact]
    public void EnsureWordDiff_WindowOfPairs_Under16ms()
    {
        // 一屏可视区（含 overscan）内的字级差异计算预算
        var (model, _) = BuildModel(sideBySide: true);
        var sw = System.Diagnostics.Stopwatch.StartNew();
        model.EnsureWordDiff(0, 60);
        sw.Stop();
        Assert.True(sw.ElapsedMilliseconds < 16, $"一屏字级差异 {sw.ElapsedMilliseconds}ms 超预算");
    }
}

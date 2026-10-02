using GitUI.Core.Models;
using Xunit;

namespace GitUI.Diff.Tests;

/// <summary>
/// diff 正确性的核心验证工具：
/// 1. <see cref="Apply"/> 把 hunk 应用到旧文本，结果必须等于新文本（git patch 语义，
///    含 git 的 0 计数块头约定），并强校验上下文行与旧文件逐字对齐；
/// 2. <see cref="ParseUnifiedDiff"/> 解析 GNU diff -u 输出，作为 oracle 对照。
/// </summary>
public static class HunkAssert
{
    public static string[] Apply(string[] oldLines, IReadOnlyList<DiffHunk> hunks)
    {
        var result = new List<string>();
        int oi = 0; // 下一条未消费的旧文件行（0 基）

        foreach (var h in hunks)
        {
            // OldCount > 0：OldStart 是 1 基首行；OldCount == 0：OldStart 是插入点前一行行号
            int start = h.OldCount > 0 ? h.OldStart - 1 : h.OldStart;
            Assert.True(start >= oi, $"hunk 区间重叠：start={start}, oi={oi}");
            while (oi < start) result.Add(oldLines[oi++]);

            int a = 0, b = 0;
            while (a < h.OldLines.Count || b < h.NewLines.Count)
            {
                char oc = a < h.OldLines.Count ? h.OldLines[a][0] : '\0';
                char nc = b < h.NewLines.Count ? h.NewLines[b][0] : '\0';

                if (oc == ' ' && nc == ' ')
                {
                    var ctxOld = h.OldLines[a][1..];
                    var ctxNew = h.NewLines[b][1..];
                    Assert.True(ctxOld == ctxNew, "hunk 内上下文行两侧不一致");
                    Assert.True(oi < oldLines.Length && oldLines[oi] == ctxOld,
                        $"上下文行与旧文件不对齐：行 {oi} 期望 '{ctxOld}'，实际 '{(oi < oldLines.Length ? oldLines[oi] : "<EOF>")}'");
                    result.Add(oldLines[oi]);
                    oi++; a++; b++;
                }
                else if (oc == '-')
                {
                    a++; oi++;
                }
                else if (nc == '+')
                {
                    result.Add(h.NewLines[b][1..]);
                    b++;
                }
                else
                {
                    Assert.Fail($"hunk 体错位：oc='{oc}', nc='{nc}' (a={a}, b={b})");
                }
            }
        }

        while (oi < oldLines.Length) result.Add(oldLines[oi++]);
        return result.ToArray();
    }

    /// <summary>应用后必须精确等于新文本的行集。</summary>
    public static void AppliesCleanly(string oldText, string newText, IReadOnlyList<DiffHunk> hunks)
    {
        var oldLines = GitUI.Core.Services.DiffText.SplitLines(oldText);
        var newLines = GitUI.Core.Services.DiffText.SplitLines(newText);
        var applied = Apply(oldLines, hunks);
        Assert.True(
            applied.SequenceEqual(newLines),
            $"应用 hunk 后与预期新文本不一致：\n期望: {string.Join("\\n", newLines)}\n实际: {string.Join("\\n", applied)}");
    }

    public static int SumAdded(IReadOnlyList<DiffHunk> hunks) => hunks.Sum(h => h.AddedCount);

    public static int SumDeleted(IReadOnlyList<DiffHunk> hunks) => hunks.Sum(h => h.DeletedCount);

    /// <summary>解析 GNU diff -u 输出（跳过 ---/+++ 头与 "\ No newline" 行）。</summary>
    public static IReadOnlyList<DiffHunk> ParseUnifiedDiff(string output)
    {
        var hunks = new List<DiffHunk>();
        int oldStart = 0, oldCount = 0, newStart = 0, newCount = 0;
        var oldLines = new List<string>();
        var newLines = new List<string>();
        bool inHunk = false;

        foreach (var raw in output.Split('\n'))
        {
            var line = raw.TrimEnd('\r');
            if (line.StartsWith("@@", StringComparison.Ordinal))
            {
                if (inHunk) Flush();
                (oldStart, oldCount, newStart, newCount) = ParseHeader(line);
                oldLines.Clear();
                newLines.Clear();
                inHunk = true;
            }
            else if (inHunk)
            {
                if (line.StartsWith('\\')) continue; // \ No newline at end of file
                if (line.StartsWith(' ')) { oldLines.Add(line); newLines.Add(line); }
                else if (line.StartsWith('-')) oldLines.Add(line);
                else if (line.StartsWith('+')) newLines.Add(line);
            }
        }
        if (inHunk) Flush();
        return hunks;

        void Flush() => hunks.Add(new DiffHunk(oldStart, oldCount, newStart, newCount, oldLines.ToArray(), newLines.ToArray()));

        static (int, int, int, int) ParseHeader(string header)
        {
            int minus = header.IndexOf('-');
            int plus = header.IndexOf('+');
            int end = header.IndexOf("@@", 2, StringComparison.Ordinal);
            var oldPart = header[minus..plus].Trim();
            var newPart = header[plus..(end > 0 ? end : header.Length)].Trim();
            return (ParseStart(oldPart), ParseCount(oldPart), ParseStart(newPart), ParseCount(newPart));
        }

        static int ParseStart(string s)
        {
            var comma = s.IndexOf(',');
            return int.Parse(comma >= 0 ? s[1..comma] : s[1..]);
        }

        static int ParseCount(string s)
        {
            var comma = s.IndexOf(',');
            return comma >= 0 ? int.Parse(s[(comma + 1)..]) : 1;
        }
    }
}

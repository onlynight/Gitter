using GitUI.Core.Models;

namespace GitUI.Core.Rules;

/// <summary>
/// 风险发现 → hunk 序号映射（纯函数，验收台画布标记用，ai-native-redesign.md §3.3）：
/// finding 的行号（新文件 1 基）落在哪个 hunk 的新侧行程内。
/// </summary>
public static class RiskHunkMapper
{
    /// <summary>返回命中的 hunk 序号集合（升序去重）。行号无法定位（二进制/超界）时忽略该条。</summary>
    public static IReadOnlyList<int> Map(IReadOnlyList<RuleFinding> findings, IReadOnlyList<DiffHunk> hunks)
    {
        ArgumentNullException.ThrowIfNull(findings);
        ArgumentNullException.ThrowIfNull(hunks);

        var result = new SortedSet<int>();
        foreach (var finding in findings)
        {
            if (finding.Line is not { } line || line <= 0) continue;
            for (var i = 0; i < hunks.Count; i++)
            {
                var h = hunks[i];
                var first = h.NewStart < 1 ? 1 : h.NewStart;
                var last = h.NewCount == 0 ? first - 1 : first + h.NewCount - 1; // 纯删除 hunk 无新侧行
                if (line >= first && line <= last)
                {
                    result.Add(i);
                    break;
                }
            }
        }
        return result.ToList();
    }
}

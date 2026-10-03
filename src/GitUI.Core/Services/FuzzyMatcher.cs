namespace GitUI.Core.Services;

/// <summary>
/// 命令面板的模糊匹配打分器（S7，design.md §4.6）。
/// 纯函数、大小写不敏感；query 为空时全部命中（得 0 分）。
/// 打分规则（越大越相关）：
/// <list type="bullet">
///   <item>连续子串命中：+60，起始越靠前加成越多（+len-pos），词首再 +8</item>
///   <item>非连续但按顺序命中（subsequence）：每字符 +2，词首命中再 +8/字</item>
///   <item>subsequence 中连续段：段内每个额外字符再 +3</item>
/// </list>
/// </summary>
public static class FuzzyMatcher
{
    /// <summary>返回得分；不匹配返回 null。<paramref name="query"/> 为空白时返回 0。</summary>
    public static int? Score(string target, string query)
    {
        if (string.IsNullOrWhiteSpace(query)) return 0;
        if (string.IsNullOrEmpty(target)) return null;

        var t = target;
        var q = query.Trim();

        var idx = t.IndexOf(q, StringComparison.OrdinalIgnoreCase);
        if (idx >= 0)
        {
            int score = 60 + Math.Max(0, t.Length - idx);
            if (IsWordStart(t, idx)) score += 8;
            return score;
        }

        // subsequence 顺序匹配（贪心取最早命中位置）
        int ti = 0, score2 = 0, prevHit = -1;
        for (int qi = 0; qi < q.Length; qi++)
        {
            var found = -1;
            while (ti < t.Length)
            {
                if (char.ToUpperInvariant(t[ti]) == char.ToUpperInvariant(q[qi]))
                {
                    found = ti;
                    ti++;
                    break;
                }
                ti++;
            }
            if (found < 0) return null;

            score2 += 2;
            if (IsWordStart(t, found)) score2 += 8;
            if (prevHit >= 0 && found == prevHit + 1) score2 += 3; // 连续段奖励
            prevHit = found;
        }

        return score2;
    }

    private static bool IsWordStart(string s, int index)
    {
        if (index == 0) return true;
        var prev = s[index - 1];
        if (!char.IsLetterOrDigit(prev)) return true;
        // camelCase 边界
        return char.IsLower(prev) && char.IsUpper(s[index]);
    }
}

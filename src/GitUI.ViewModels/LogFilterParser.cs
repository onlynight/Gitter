using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using GitUI.Core.Models;

namespace GitUI.ViewModels;

/// <summary>
/// Log 搜索框语法的解析器（design.md §4.2 P0"搜索过滤"）：
/// <c>author:</c> <c>branch:</c> <c>after:</c> <c>before:</c> <c>topic:</c> 前缀词 + 自由词。
/// 自由词按"过滤"语义处理：按字面子串匹配（大小写不敏感），多词要求全部命中（AND）；
/// <c>topic:</c> 的值由用户显式书写的正则原样透传（非法正则由服务层回退为子串匹配）。
/// 同前缀多次出现时后者生效；非法日期值整体降级为自由词。
/// </summary>
public static class LogFilterParser
{
    /// <summary>把搜索文本解析为 <see cref="LogFilter"/>（分页参数由调用方补充）。</summary>
    public static LogFilter Parse(string? query, int limit = 50, int skip = 0)
    {
        string? author = null, branch = null, topic = null;
        DateTimeOffset? after = null, before = null;
        var freeWords = new List<string>();

        foreach (var token in Tokenize(query))
        {
            if (TakePrefixed(token, "author:", out var v)) author = v;
            else if (TakePrefixed(token, "branch:", out v)) branch = v;
            else if (TakePrefixed(token, "topic:", out v)) topic = v;
            else if (TakePrefixed(token, "after:", out v))
            {
                if (TryParseDate(v, out var t)) after = t; else freeWords.Add(token);
            }
            else if (TakePrefixed(token, "before:", out v))
            {
                if (TryParseDate(v, out var t)) before = t; else freeWords.Add(token);
            }
            else freeWords.Add(token);
        }

        // 多段合并为 AND：(?i)(?=.*p1)(?=.*p2)...
        // .* 依赖服务端 MatchesTopic 的 RegexOptions.Singleline 跨行扫描；(?=p) 写法
        // 语义是"同一位置同时命中"，对出现在不同位置的词永远为假，不能用。
        var parts = new List<(string Pattern, bool Literal)>();
        if (topic is not null) parts.Add((topic, Literal: false));
        parts.AddRange(freeWords.Select(w => (w, Literal: true)));

        string? topicFilter = parts.Count switch
        {
            0 => null,
            1 => parts[0].Literal ? "(?i)" + Regex.Escape(parts[0].Pattern) : parts[0].Pattern,
            _ => "(?i)" + string.Concat(
                     parts.Select(p => "(?=.*" + (p.Literal ? Regex.Escape(p.Pattern) : p.Pattern) + ")")),
        };

        return new LogFilter(author, topicFilter, branch, after, before, limit, skip).Normalize();
    }

    /// <summary>按空白分词，双引号/单引号包裹的段视为一个词（引号剥除）。</summary>
    private static List<string> Tokenize(string? query)
    {
        var tokens = new List<string>();
        if (string.IsNullOrWhiteSpace(query)) return tokens;

        var sb = new StringBuilder();
        char? quote = null;
        foreach (var ch in query)
        {
            if (quote is not null)
            {
                if (ch == quote) { quote = null; continue; }
                sb.Append(ch);
            }
            else if (ch is '"' or '\'') quote = ch;
            else if (char.IsWhiteSpace(ch)) Flush(tokens, sb);
            else sb.Append(ch);
        }
        Flush(tokens, sb);
        return tokens;
    }

    private static void Flush(List<string> tokens, StringBuilder sb)
    {
        if (sb.Length > 0)
        {
            tokens.Add(sb.ToString());
            sb.Clear();
        }
    }

    /// <summary>匹配 <paramref name="prefix"/> 前缀（大小写不敏感），成功时输出剥前缀并去引号后的值。</summary>
    private static bool TakePrefixed(string token, string prefix, out string value)
    {
        if (token.Length > prefix.Length
            && token.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            value = token[prefix.Length..].Trim('"', '\'');
            if (value.Length > 0) return true;
        }
        value = string.Empty;
        return false;
    }

    /// <summary>日期解析：不变文化 + 本地时区，支持 yyyy-MM-dd、yyyy-M-d、含时刻等常见写法。</summary>
    private static bool TryParseDate(string text, out DateTimeOffset value)
    {
        if (DateTime.TryParse(
                text,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeLocal | DateTimeStyles.AllowWhiteSpaces,
                out var dt))
        {
            value = new DateTimeOffset(dt);
            return true;
        }
        value = default;
        return false;
    }
}

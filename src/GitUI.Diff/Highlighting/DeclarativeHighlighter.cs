using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace GitUI.Diff.Highlighting;

/// <summary>声明式高亮器（code-highlight-framework.md §四.2）：
/// 规则 = 关键字表 + 正则顺序表，按声明顺序"最早命中优先"，命中即消费。</summary>
public sealed class DeclarativeHighlighter : ISyntaxHighlighter
{
    private readonly string _id;
    private readonly string _language;
    private readonly IReadOnlyList<string> _extensions;
    private readonly List<(string Style, Regex Pattern)> _rules;

    private DeclarativeHighlighter(string id, string language, IReadOnlyList<string> extensions, List<(string, Regex)> rules)
    {
        _id = id;
        _language = language;
        _extensions = extensions;
        _rules = rules;
    }

    public string Id => _id;
    public string Language => _language;
    public IReadOnlyList<string> Extensions => _extensions;

    public LineHighlightResult TokenizeLine(string line, LineState? state)
    {
        if (line.Length == 0)
        {
            return new LineHighlightResult(Array.Empty<SyntaxSpan>(), state);
        }

        var spans = new List<SyntaxSpan>();
        int pos = 0;
        while (pos < line.Length)
        {
            int bestIndex = int.MaxValue;
            int bestLength = 0;
            string? bestStyle = null;

            foreach (var (style, pattern) in _rules)
            {
                var m = pattern.Match(line, pos);
                if (!m.Success || m.Length == 0)
                {
                    continue;
                }

                if (m.Index < bestIndex || (m.Index == bestIndex && m.Length > bestLength))
                {
                    bestIndex = m.Index;
                    bestLength = m.Length;
                    bestStyle = style;
                }
            }

            if (bestStyle is null)
            {
                break; // 余下无任何命中 → 纯文本
            }

            spans.Add(new SyntaxSpan(bestIndex, bestLength, bestStyle));
            pos = bestIndex + bestLength;
        }

        return new LineHighlightResult(spans, state);
    }

    // ---- grammar JSON ----

    public sealed class GrammarFile
    {
        [JsonPropertyName("highlighters")]
        public List<GrammarDef> Highlighters { get; set; } = new();
    }

    public sealed class GrammarDef
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = "";

        [JsonPropertyName("language")]
        public string Language { get; set; } = "";

        [JsonPropertyName("extensions")]
        public List<string> Extensions { get; set; } = new();

        [JsonPropertyName("rules")]
        public List<GrammarRule> Rules { get; set; } = new();
    }

    public sealed class GrammarRule
    {
        [JsonPropertyName("style")]
        public string Style { get; set; } = "";

        [JsonPropertyName("pattern")]
        public string? Pattern { get; set; }

        [JsonPropertyName("keywords")]
        public List<string>? Keywords { get; set; }
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    /// <summary>从 highlighters.json 装载全部声明式高亮器；单条规则/语言无效时跳过不抛。</summary>
    public static IReadOnlyList<DeclarativeHighlighter> LoadAll(string json)
    {
        var file = JsonSerializer.Deserialize<GrammarFile>(json, JsonOptions);
        if (file is null)
        {
            return Array.Empty<DeclarativeHighlighter>();
        }

        var result = new List<DeclarativeHighlighter>();
        foreach (var def in file.Highlighters)
        {
            var h = TryBuild(def);
            if (h is not null)
            {
                result.Add(h);
            }
        }

        return result;
    }

    private static DeclarativeHighlighter? TryBuild(GrammarDef def)
    {
        if (string.IsNullOrWhiteSpace(def.Id) || def.Extensions.Count == 0 || def.Rules.Count == 0)
        {
            return null;
        }

        var rules = new List<(string Style, Regex Pattern)>();
        foreach (var rule in def.Rules)
        {
            if (string.IsNullOrWhiteSpace(rule.Style))
            {
                continue;
            }

            try
            {
                if (rule.Keywords is { Count: > 0 })
                {
                    var alternation = string.Join("|", rule.Keywords.Select(Regex.Escape));
                    rules.Add((rule.Style, new Regex(@"\b(?:" + alternation + @")\b", RegexOptions.Compiled)));
                }
                else if (!string.IsNullOrWhiteSpace(rule.Pattern))
                {
                    rules.Add((rule.Style, new Regex(rule.Pattern, RegexOptions.Compiled)));
                }
            }
            catch (ArgumentException)
            {
                // 单条正则无效 → 跳过该规则，不影响整语言
            }
        }

        if (rules.Count == 0)
        {
            return null;
        }

        return new DeclarativeHighlighter(def.Id, def.Language, def.Extensions, rules);
    }
}

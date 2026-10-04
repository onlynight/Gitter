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
    private readonly List<BlockRule> _blockRules = new();



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

    /// <summary>存在跨行块规则 → 消费方须按行序分词（P4a）。</summary>
    public bool RequiresSequentialState => _blockRules.Count > 0;

    /// <summary>工厂入口（TextMate 子集 / 测试用）：直接以已编译规则构建。</summary>
    public static DeclarativeHighlighter Create(
        string id, string language, IReadOnlyList<string> extensions,
        List<(string Style, Regex Pattern)> rules, List<BlockRule> blockRules)
    {
        var h = new DeclarativeHighlighter(id, language, extensions, rules);
        h._blockRules.AddRange(blockRules);
        return h;
    }

    public LineHighlightResult TokenizeLine(string line, LineState? state)
    {
        if (_blockRules.Count > 0)
        {
            return TokenizeLineSequential(line, state);
        }

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

    /// <summary>跨行块规则（P4a）。</summary>
    public sealed record BlockRule(string Style, Regex Start, Regex End);

    /// <summary>跨行块状态：每个块规则一位（int 掩码，支持 ≤32 条块规则）。</summary>
    public sealed class BlockMaskState : LineState
    {
        public int Mask { get; init; }
    }

    /// <summary>
    /// 顺序分词（P4a）：活动块内优先找 endPattern，整段按块样式；
    /// 无活动块时所有规则（含块起始）最早命中优先，块起始命中后置状态位。
    /// 状态经 LineState.Payload（BlockMaskState）跨行传递。
    /// </summary>
    private LineHighlightResult TokenizeLineSequential(string line, LineState? state)
    {
        int mask = (state as BlockMaskState)?.Mask ?? 0;
        var spans = new List<SyntaxSpan>();
        int pos = 0;

        while (pos < line.Length)
        {
            // 1) 活动块：按规则顺序找第一个活动的块，找其 end
            int active = -1;
            for (int i = 0; i < _blockRules.Count; i++)
            {
                if ((mask & (1 << i)) != 0) { active = i; break; }
            }

            if (active >= 0)
            {
                var endM = _blockRules[active].End.Match(line, pos);
                if (endM.Success && endM.Index == pos)
                {
                    spans.Add(new SyntaxSpan(pos, endM.Length, _blockRules[active].Style)); // 结束符同样式
                    mask &= ~(1 << active);
                    pos += endM.Length;
                    continue;
                }

                if (endM.Success)
                {
                    if (endM.Index > pos)
                    {
                        spans.Add(new SyntaxSpan(pos, endM.Index - pos, _blockRules[active].Style));
                    }

                    spans.Add(new SyntaxSpan(endM.Index, endM.Length, _blockRules[active].Style)); // 结束符同样式
                    mask &= ~(1 << active);
                    pos = endM.Index + endM.Length;
                    continue;
                }

                // 整行都在块内
                spans.Add(new SyntaxSpan(pos, line.Length - pos, _blockRules[active].Style));
                pos = line.Length;
                break;
            }

            // 2) 无活动块：普通规则 + 块起始，最早命中优先（同位置长者胜）
            int bestIndex = int.MaxValue;
            int bestLength = 0;
            string? bestStyle = null;
            int bestBlock = -1;

            foreach (var (style, pattern) in _rules)
            {
                var m = pattern.Match(line, pos);
                if (!m.Success || m.Length == 0) continue;
                if (m.Index < bestIndex || (m.Index == bestIndex && m.Length > bestLength))
                {
                    bestIndex = m.Index; bestLength = m.Length; bestStyle = style; bestBlock = -1;
                }
            }

            for (int i = 0; i < _blockRules.Count; i++)
            {
                var m = _blockRules[i].Start.Match(line, pos);
                if (!m.Success || m.Length == 0) continue;
                if (m.Index < bestIndex || (m.Index == bestIndex && m.Length > bestLength))
                {
                    bestIndex = m.Index; bestLength = m.Length; bestStyle = _blockRules[i].Style; bestBlock = i;
                }
            }

            if (bestStyle is null)
            {
                break; // 余下无命中 → 纯文本
            }

            spans.Add(new SyntaxSpan(bestIndex, bestLength, bestStyle));
            pos = bestIndex + bestLength;
            if (bestBlock >= 0)
            {
                mask |= 1 << bestBlock;
            }
        }

        LineState? nextState = mask != 0 ? new BlockMaskState { Mask = mask } : LineState.None;

        // 合并相邻同样式片段（块起始与块内段相邻时避免碎片段）
        if (spans.Count > 1)
        {
            spans.Sort((a, b) => a.Start.CompareTo(b.Start));
            var merged = new List<SyntaxSpan>(spans.Count);
            foreach (var span in spans)
            {
                if (merged.Count > 0
                    && merged[^1].StyleKey == span.StyleKey
                    && merged[^1].Start + merged[^1].Length == span.Start)
                {
                    merged[^1] = merged[^1] with { Length = merged[^1].Length + span.Length };
                }
                else
                {
                    merged.Add(span);
                }
            }

            spans = merged;
        }

        return new LineHighlightResult(spans, nextState);
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

        /// <summary>跨行块起始（P4a）：与 blockEnd 成对；命中后直到 endPattern 间整段按本样式。</summary>
        [JsonPropertyName("blockStart")]
        public string? BlockStart { get; set; }

        [JsonPropertyName("blockEnd")]
        public string? BlockEnd { get; set; }
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
        var blockRules = new List<BlockRule>();
        foreach (var rule in def.Rules)
        {
            if (string.IsNullOrWhiteSpace(rule.Style))
            {
                continue;
            }

            try
            {
                if (!string.IsNullOrWhiteSpace(rule.BlockStart) && !string.IsNullOrWhiteSpace(rule.BlockEnd))
                {
                    blockRules.Add(new BlockRule(
                        rule.Style,
                        new Regex(rule.BlockStart, RegexOptions.Compiled),
                        new Regex(rule.BlockEnd, RegexOptions.Compiled)));
                }
                else if (rule.Keywords is { Count: > 0 })
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

        if (rules.Count == 0 && blockRules.Count == 0)
        {
            return null;
        }

        var highlighter = new DeclarativeHighlighter(def.Id, def.Language, def.Extensions, rules);
        highlighter._blockRules.AddRange(blockRules);
        return highlighter;
    }
}

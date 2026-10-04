# patch-p4a.py - P4a: cross-line block comments in DeclarativeHighlighter + sequential tokenizer
p = "src/GitUI.Diff/Highlighting/DeclarativeHighlighter.cs"
raw = open(p, "rb").read()
bom = raw.startswith(b"\xef\xbb\xbf")
s = raw.decode("utf-8-sig" if bom else "utf-8").replace("\r\n", "\n")

def rep(old, new, tag):
    global s
    assert old in s, "anchor missing: " + tag
    s = s.replace(old, new, 1)

# 1) GrammarRule：blockStart/blockEnd
rep("""    public sealed class GrammarRule
    {
        [JsonPropertyName("style")]
        public string Style { get; set; } = "";

        [JsonPropertyName("pattern")]
        public string? Pattern { get; set; }

        [JsonPropertyName("keywords")]
        public List<string>? Keywords { get; set; }
    }""",
    """    public sealed class GrammarRule
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
    }""", "rule")

# 2) 字段 + IsStateful + TokenizeLine 分派
rep("""    private readonly string _id;
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
    {""",
    """    private readonly string _id;
    private readonly string _language;
    private readonly IReadOnlyList<string> _extensions;
    private readonly List<(string Style, Regex Pattern)> _rules;
    private readonly List<BlockRule> _blockRules = new();

    /// <summary>跨行块规则（code-highlight-framework.md P4a）：消费方须按行序分词（RequiresSequentialState）。</summary>
    public bool RequiresSequentialState => _blockRules.Count > 0;

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
        if (_blockRules.Count > 0)
        {
            return TokenizeLineSequential(line, state);
        }
""", "fields")

# 4) 顺序版实现 + BlockRule/BlockMaskState（插到 TokenizeLine 闭合后、LoadAll 前）
rep("""    // ---- grammar JSON ----""",
    """    private readonly record struct BlockRule(string Style, Regex Start, Regex End);

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
                    mask &= ~(1 << active); // 块在同一位置立即结束
                    pos += endM.Length;
                    continue;
                }

                if (endM.Success)
                {
                    spans.Add(new SyntaxSpan(pos, endM.Index - pos, _blockRules[active].Style));
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
        return new LineHighlightResult(spans, nextState);
    }

    // ---- grammar JSON ----""", "seq")

# 5) TryBuild：解析 block 规则
rep("""            try
            {
                if (rule.Keywords is { Count: > 0 })
                {
                    var alternation = string.Join("|", rule.Keywords.Select(Regex.Escape));
                    rules.Add((rule.Style, new Regex(@"\\b(?:" + alternation + @")\\b", RegexOptions.Compiled)));
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

        return new DeclarativeHighlighter(def.Id, def.Language, def.Extensions, rules);""",
    """            try
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
                    rules.Add((rule.Style, new Regex(@"\\b(?:" + alternation + @")\\b", RegexOptions.Compiled)));
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
        return highlighter;""", "build")

# 6) TryBuild 内 blockRules 局部集合声明
rep("""        var rules = new List<(string Style, Regex Pattern)>();
        foreach (var rule in def.Rules)
        {""",
    """        var rules = new List<(string Style, Regex Pattern)>();
        var blockRules = new List<BlockRule>();
        foreach (var rule in def.Rules)
        {""", "blocklist")

open(p, "wb").write((b"\xef\xbb\xbf" if bom else b"") + s.replace("\n", "\r\n").encode("utf-8"))
print("P4a engine patched")

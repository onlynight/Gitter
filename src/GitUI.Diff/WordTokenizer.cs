namespace GitUI.Diff;

/// <summary>
/// 字级差异的分词器：把一行拆成 diff 词元（token）。
/// 规则（VSCode 行内 diff 同源思路，对代码与中文都给出合理粒度）：
/// <list type="bullet">
///   <item>ASCII 字母/数字/下划线的连续串 → 一个词元；</item>
///   <item>连续空白 → 一个词元（缩进整体变化算一处差异）；</item>
///   <item>其余字符（标点、CJK、emoji 等非 ASCII）→ 每个字符一个词元。</item>
/// </list>
/// </summary>
internal static class WordTokenizer
{
    public static List<string> Tokenize(string line)
    {
        var tokens = new List<string>(line.Length / 4 + 1);
        var sb = new System.Text.StringBuilder();
        var runKind = CharKind.Other;

        void Flush()
        {
            if (sb.Length > 0)
            {
                tokens.Add(sb.ToString());
                sb.Clear();
            }
        }

        foreach (var ch in line)
        {
            var kind = Classify(ch);
            if (kind == runKind && kind != CharKind.Other)
            {
                sb.Append(ch);
            }
            else
            {
                Flush();
                sb.Append(ch);
                runKind = kind;
            }
        }
        Flush();
        return tokens;
    }

    private static CharKind Classify(char ch)
    {
        if (ch == '_' || char.IsAsciiLetterOrDigit(ch)) return CharKind.Word;
        if (char.IsWhiteSpace(ch)) return CharKind.Space;
        return CharKind.Other;
    }

    private enum CharKind : byte
    {
        Word,
        Space,
        Other,
    }
}

namespace GitUI.Core.Services;

/// <summary>
/// Diff 用文本行切分工具。行语义与 git 对齐，全项目统一使用这一份定义：
/// <list type="bullet">
///   <item>仅以 <c>\n</c> 切分；行尾的 <c>\r</c> 是行内容的一部分（git 同语义，
///         因此 CRLF → LF 是真实差异，不会被误判为无变化）。</item>
///   <item>无"幻影尾行"：<c>"a\n"</c> 是 1 行，<c>"a"</c> 也是 1 行。
///         两者行内容相等，EOF 是否有换行符的差异由 <see cref="EndsWithNewline"/>
///         单独携带（渲染层据此显示 git 的 "\ No newline at end of file" 标记）。</item>
/// </list>
/// </summary>
public static class DiffText
{
    /// <summary>把文本切分为行。空文本返回空数组。</summary>
    public static string[] SplitLines(string text)
    {
        if (string.IsNullOrEmpty(text)) return Array.Empty<string>();

        var lines = new List<string>(text.Length / 24 + 1);
        int start = 0;
        for (int i = 0; i < text.Length; i++)
        {
            if (text[i] == '\n')
            {
                lines.Add(text[start..i]);
                start = i + 1;
            }
        }

        if (start < text.Length) lines.Add(text[start..]);
        return lines.ToArray();
    }

    /// <summary>文本是否以换行符结尾（CRLF 或 LF）。空文本返回 true（与空行集合一致）。</summary>
    public static bool EndsWithNewline(string text)
        => string.IsNullOrEmpty(text) || text[^1] == '\n';

    /// <summary>行数，与 <see cref="SplitLines"/> 一致：空文本 0 行，"a\n" 1 行。</summary>
    public static int CountLines(string text)
    {
        if (string.IsNullOrEmpty(text)) return 0;
        int count = 1;
        foreach (var ch in text)
        {
            if (ch == '\n') count++;
        }

        // "a\nb\n" → 2 行；末尾换行符不算新行
        return text[^1] == '\n' ? count - 1 : count;
    }
}

using GitUI.Core.Models;

namespace GitUI.Core.Services;

/// <summary>
/// unified diff 文本工具（纯文本处理）：
/// <see cref="ParseHunks"/> 把 patch 文本解析为 <see cref="DiffHunk"/> 列表（渲染用），
/// <see cref="SplitHunks"/> 把 patch 按 "@@" 边界切成可直接 `git apply --cached` 的分块
/// （hunk 级暂存用，S5）。两者对 hunk 边界的判定一致（行首 "@@"），保证块序号一一对应。
/// </summary>
public static class UnifiedPatch
{
    /// <summary>解析 unified diff 文本为 hunk 列表；无 hunk（纯 header/二进制/空）返回空列表。</summary>
    public static IReadOnlyList<DiffHunk> ParseHunks(string? patch)
    {
        if (string.IsNullOrEmpty(patch)) return Array.Empty<DiffHunk>();
        var lines = patch.Split('\n');
        var hunks = new List<DiffHunk>();
        int oldStart = 0, oldCount = 0, newStart = 0, newCount = 0;
        var oldLines = new List<string>();
        var newLines = new List<string>();
        bool inHunk = false;

        foreach (var raw in lines)
        {
            var line = raw.TrimEnd('\r');
            if (line.StartsWith("@@"))
            {
                if (inHunk)
                    hunks.Add(new DiffHunk(oldStart, oldCount, newStart, newCount, oldLines, newLines));
                inHunk = true;
                ParseHunkHeader(line, out oldStart, out oldCount, out newStart, out newCount);
                oldLines.Clear();
                newLines.Clear();
            }
            else if (inHunk)
            {
                if (line.StartsWith(' ')) { oldLines.Add(line); newLines.Add(line); }
                else if (line.StartsWith('-')) oldLines.Add(line);
                else if (line.StartsWith('+')) newLines.Add(line);
                // "\ No newline at end of file" 标记行与空行（patch 末尾）忽略——
                // git 语义上属于前一 hunk 的尾注，不构成内容行
            }
        }
        if (inHunk)
            hunks.Add(new DiffHunk(oldStart, oldCount, newStart, newCount, oldLines, newLines));

        return hunks;
    }

    /// <summary>
    /// 把完整 patch 切成"文件头 + 第 k 个 hunk"的分块列表，第 k 块可直接交给
    /// <c>git apply --cached</c>（或加 --reverse 反向应用）实现 hunk 级暂存/撤销。
    /// 无 hunk 时返回空列表。
    /// </summary>
    public static IReadOnlyList<string> SplitHunks(string? patch)
    {
        var result = new List<string>();
        if (string.IsNullOrEmpty(patch)) return result;

        var lines = patch.Split('\n');
        var header = new List<string>();
        var current = new List<string>();
        bool inHunk = false;

        foreach (var raw in lines)
        {
            var line = raw.TrimEnd('\r');
            if (line.StartsWith("@@"))
            {
                if (inHunk) result.Add(Join(header, current));
                inHunk = true;
                current.Clear();
                current.Add(line);
            }
            else if (inHunk)
            {
                current.Add(line);
            }
            else
            {
                header.Add(line);
            }
        }
        if (inHunk) result.Add(Join(header, current));

        return result;
    }

    /// <summary>
    /// 从 patch 文本检测两侧文件末尾是否有换行符（git 的 "\ No newline at end of file"
    /// 标记跟随在缺失换行的一侧内容行之后）。无标记时两侧均为 true。
    /// </summary>
    public static (bool OldEndsWithNewline, bool NewEndsWithNewline) DetectEndOfNewline(string? patch)
    {
        bool oldEof = true, newEof = true;
        if (string.IsNullOrEmpty(patch)) return (oldEof, newEof);

        string prev = string.Empty;
        foreach (var raw in patch.Split('\n'))
        {
            var line = raw.TrimEnd('\r');
            if (line.StartsWith("\\ No newline at end of file", StringComparison.Ordinal))
            {
                if (prev.StartsWith('+')) newEof = false;
                else if (prev.StartsWith('-')) oldEof = false;
                else if (prev.StartsWith(' ')) { oldEof = false; newEof = false; }
            }
            prev = line;
        }
        return (oldEof, newEof);
    }

    private static string Join(List<string> header, List<string> body) =>
        string.Join("\n", header.Concat(body).Where(l => l.Length > 0)) + "\n";

    /// <summary>解析 "@@ -1,7 +1,7 @@ [可选节标题]" 块头（git 语义：省略计数 = 1）。</summary>
    private static void ParseHunkHeader(
        string header, out int oldStart, out int oldCount, out int newStart, out int newCount)
    {
        // 按空白分词后取首个 -/+ token，剥掉符号再解析（S3 修复：整段解析会把
        // 旧侧起始行解析成 -1、计数回退成 1）
        oldStart = oldCount = newStart = newCount = 0;
        string? oldTok = null, newTok = null;
        foreach (var tok in header.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            if (oldTok is null && tok.Length > 1 && tok[0] == '-') oldTok = tok[1..];
            else if (newTok is null && tok.Length > 1 && tok[0] == '+') newTok = tok[1..];
        }

        if (oldTok is not null) ParseRange(oldTok, out oldStart, out oldCount);
        if (newTok is not null) ParseRange(newTok, out newStart, out newCount);
    }

    private static void ParseRange(string s, out int start, out int count)
    {
        start = count = 0;
        var comma = s.IndexOf(',');
        var range = comma >= 0 ? s[..comma] : s;
        if (!int.TryParse(range, out start)) return;
        count = comma >= 0 && int.TryParse(s[(comma + 1)..], out var c) ? c : 1;
    }
}

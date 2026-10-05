namespace GitUI.Core.Rules;

/// <summary>退回重做的一个文件反馈输入：选中的 hunk patch 块 + 可选批注（ai-native-redesign.md §3.4）。</summary>
public sealed record ReviewFeedbackFile(
    string Path,
    IReadOnlyList<string> PatchChunks,
    IReadOnlyList<int> HunkIndices);

/// <summary>
/// "退回重做"反馈 prompt 构造（纯函数）：把选中的 hunk diff + 人的批注组装成
/// 结构化修改指令，v1 复制到剪贴板（用户粘回任意 agent），H2 起经 harness 直投。
/// </summary>
public static class ReviewFeedbackBuilder
{
    public static string Build(IReadOnlyList<ReviewFeedbackFile> files, string? note)
    {
        ArgumentNullException.ThrowIfNull(files);
        var sb = new System.Text.StringBuilder();
        sb.AppendLine("请按以下反馈修改代码。只修改指出的内容，不要改动其他部分，不要重新格式化。");
        if (!string.IsNullOrWhiteSpace(note))
        {
            sb.AppendLine();
            sb.AppendLine("## 问题");
            sb.AppendLine(note.Trim());
        }
        foreach (var file in files)
        {
            sb.AppendLine();
            sb.AppendLine($"## 文件：{file.Path}");
            foreach (var i in file.HunkIndices)
            {
                if (i < 0 || i >= file.PatchChunks.Count) continue;
                sb.AppendLine("```diff");
                sb.AppendLine(file.PatchChunks[i].TrimEnd());
                sb.AppendLine("```");
            }
        }
        return sb.ToString();
    }
}

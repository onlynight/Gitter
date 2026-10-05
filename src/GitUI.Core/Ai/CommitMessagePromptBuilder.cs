using System.Text;
using GitUI.Core.Settings;

namespace GitUI.Core.Ai;

/// <summary>生成提交信息时一个待提交文件的描述。</summary>
public sealed record CommitMessageFile(string Path, int AddedLines, int DeletedLines);

/// <summary>提交信息生成的输入（privacy 决定 DiffText 是否随请求发出）。</summary>
public sealed record CommitMessageInput(
    IReadOnlyList<string> RecentSubjects,
    IReadOnlyList<CommitMessageFile> Files,
    string? DiffText);

/// <summary>
/// 提交信息 prompt 构造（ai-native-redesign.md §4.1，纯函数）：
/// - few-shot 风格学习：把仓库最近的人写提交主题作为示例，要求模型沿用仓库既有风格（语言/格式/scope 习惯）；
/// - 隐私分级：MetadataOnly 只发文件路径 + 增删行数；FullDiff 附 diff 文本（截断到预算）；
///   secrets 过筛在调用方（发送前阻断），本类不重复做。
/// </summary>
public static class CommitMessagePromptBuilder
{
    /// <summary>FullDiff 档位下随请求发送的 diff 最大字符数。</summary>
    public const int DiffBudgetChars = 12_000;
    private const int MaxFewShot = 20;

    public static AiPrompt Build(CommitMessageInput input, AiPrivacyLevel privacy)
    {
        ArgumentNullException.ThrowIfNull(input);
        var sb = new StringBuilder();

        sb.AppendLine("You are a commit message assistant inside a git client.");
        sb.AppendLine("Write ONE conventional-commit style message for the staged changes described below.");
        sb.AppendLine("Rules:");
        sb.AppendLine("- Output ONLY the message subject line (optionally a short body after a blank line). No quotes, no code fences, no explanations.");
        sb.AppendLine("- Prefer format \"type: subject\" (type = feat|fix|docs|test|build|chore|refactor) unless the examples below suggest otherwise.");
        sb.AppendLine("- Subject <= 72 characters, imperative mood, no trailing period.");
        if (input.RecentSubjects.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("Match the language and style of these recent commit messages from the same repository:");
            foreach (var subject in input.RecentSubjects.Take(MaxFewShot))
                sb.AppendLine("- " + subject.ReplaceLineEndings(" "));
        }
        var system = sb.ToString();

        sb.Clear();
        sb.AppendLine("Staged files (path, +added, -deleted):");
        foreach (var f in input.Files)
            sb.AppendLine($"- {f.Path} (+{f.AddedLines}, -{f.DeletedLines})");

        if (privacy == AiPrivacyLevel.FullDiff && !string.IsNullOrWhiteSpace(input.DiffText))
        {
            sb.AppendLine();
            sb.AppendLine("Diff (may be truncated):");
            sb.AppendLine("```diff");
            var diff = input.DiffText;
            if (diff.Length > DiffBudgetChars) diff = diff[..DiffBudgetChars] + "\n… (truncated)";
            sb.AppendLine(diff);
            sb.AppendLine("```");
        }

        sb.AppendLine();
        sb.AppendLine("Write the commit message now.");
        return new AiPrompt(system, sb.ToString(), MaxOutputTokens: 300);
    }

    /// <summary>metadata 档位下 diff 不出网；即使传入也强制忽略（调用方无需预判断）。</summary>
    public static CommitMessageInput WithoutDiff(CommitMessageInput input) =>
        input with { DiffText = null };

    /// <summary>清理模型输出草稿：去代码围栏/包裹引号/空行，保留主题行 + 可选 body。</summary>
    public static string CleanDraft(string draft)
    {
        var text = draft.Trim().Trim('`');
        var lines = text.Split('\n')
            .Select(l => l.TrimEnd('\r').Trim())
            .Where(l => l.Length > 0 && !l.StartsWith("```", StringComparison.Ordinal))
            .ToList();
        if (lines.Count == 0) return string.Empty;
        // 单行草稿剥掉包裹引号
        var subject = lines[0];
        if (subject.Length >= 2 && (subject[0] == '"' || subject[0] == '\'') && subject[^1] == subject[0])
            subject = subject[1..^1];
        lines[0] = subject;
        return string.Join("\n", lines);
    }
}

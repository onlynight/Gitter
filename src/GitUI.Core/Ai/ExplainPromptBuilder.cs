using System.Text;
using GitUI.Core.Settings;

namespace GitUI.Core.Ai;

/// <summary>AI 解释批注（ai-native-redesign.md §3.5）的输入：与提交信息生成同一隐私模型。</summary>
public sealed record ExplainInput(
    IReadOnlyList<CommitMessageFile> Files,
    string? DiffText);

public enum ExplainIntent
{
    /// <summary>解释这次改动。</summary>
    Explain = 0,
    /// <summary>指出风险与疑点。</summary>
    Review = 1,
}

/// <summary>解释/批注 prompt 构造（纯函数）：隐私分级与提交信息生成共用（§8.2）。</summary>
public static class ExplainPromptBuilder
{
    public static AiPrompt Build(ExplainInput input, AiPrivacyLevel privacy, ExplainIntent intent)
    {
        ArgumentNullException.ThrowIfNull(input);
        var system = intent == ExplainIntent.Review
            ? "You are a precise code review assistant. Point out risks, bugs and suspicious patterns in the described changes. Be concrete and terse; reference files by path. Answer in the same language the diff content uses. Output plain text, no markdown headings."
            : "You are a precise code explanation assistant. Explain what the described changes do and why they might be made. Be concrete and terse; reference files by path. Answer in the same language the diff content uses. Output plain text, no markdown headings.";

        var sb = new StringBuilder();
        sb.AppendLine(intent == ExplainIntent.Review ? "Review these changes:" : "Explain these changes:");
        sb.AppendLine();
        sb.AppendLine("Files (path, +added, -deleted):");
        foreach (var f in input.Files)
            sb.AppendLine($"- {f.Path} (+{f.AddedLines}, -{f.DeletedLines})");

        if (privacy == AiPrivacyLevel.FullDiff && !string.IsNullOrWhiteSpace(input.DiffText))
        {
            sb.AppendLine();
            sb.AppendLine("Diff (may be truncated):");
            sb.AppendLine("```diff");
            var diff = input.DiffText;
            if (diff.Length > CommitMessagePromptBuilder.DiffBudgetChars)
                diff = diff[..CommitMessagePromptBuilder.DiffBudgetChars] + "\n… (truncated)";
            sb.AppendLine(diff);
            sb.AppendLine("```");
        }

        return new AiPrompt(system, sb.ToString(), MaxOutputTokens: 600);
    }
}

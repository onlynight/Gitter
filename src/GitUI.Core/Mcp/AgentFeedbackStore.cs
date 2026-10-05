using System.Text.Json;

namespace GitUI.Core.Mcp;

/// <summary>
/// agent → 人 的审查反馈存取（ai-native-redesign.md §7.2 review.submit_feedback）。
/// 存 <c>&lt;repo&gt;/.git/gitter/feedback.json</c>（仓库本地、不入版本控制），
/// 变更页刷新时读出展示。纯静态、文件损坏时返回 null（不抛）。
/// </summary>
public static class AgentFeedbackStore
{
    public sealed record Feedback(string Note, string? Path, DateTimeOffset CreatedAt);

    private static string FileOf(string workDir) =>
        System.IO.Path.Combine(workDir, ".git", "gitter", "feedback.json");

    public static void Write(string workDir, string note, string? path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(workDir);
        ArgumentException.ThrowIfNullOrWhiteSpace(note);

        var dir = System.IO.Path.GetDirectoryName(FileOf(workDir))!;
        System.IO.Directory.CreateDirectory(dir);
        var payload = new Feedback(note, path, DateTimeOffset.Now);
        System.IO.File.WriteAllText(FileOf(workDir), JsonSerializer.Serialize(payload));
    }

    /// <summary>读取未消费的反馈；无/损坏返回 null。</summary>
    public static Feedback? Read(string workDir)
    {
        try
        {
            var file = FileOf(workDir);
            if (!System.IO.File.Exists(file)) return null;
            using var doc = JsonDocument.Parse(System.IO.File.ReadAllText(file));
            var root = doc.RootElement;
            var note = root.TryGetProperty("Note", out var n) && n.ValueKind == JsonValueKind.String ? n.GetString() : null;
            if (note is null) return null;
            var path = root.TryGetProperty("Path", out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;
            var at = root.TryGetProperty("CreatedAt", out var c) && c.ValueKind == JsonValueKind.String
                && DateTimeOffset.TryParse(c.GetString(), out var parsed) ? parsed : DateTimeOffset.Now;
            return new Feedback(note, path, at);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>消费（删除）反馈：人看过即清除。</summary>
    public static void Clear(string workDir)
    {
        try { System.IO.File.Delete(FileOf(workDir)); }
        catch { /* 不存在/占用：忽略 */ }
    }
}

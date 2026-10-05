using System.Text.Json;
using GitUI.Core.Mcp;
using GitUI.Core.Models;
using GitUI.Core.Services;

namespace GitUI.Git.Mcp;

public sealed record McpServerOptions(
    /// <summary>允许 stage/commit 等写操作，无需逐次确认（显式信任模式，默认关闭）。</summary>
    bool AllowWrites = false,
    /// <summary>
    /// 写操作人审回调（ai-native-redesign.md §7.2 人审确认）：AllowWrites=false 且回调非空时，
    /// 每个写工具调用先请求人工批准（GUI 弹卡，超时视为拒绝）；回调为空 = 直接拒绝。
    /// 描述文案用于确认卡展示。
    /// </summary>
    Func<string, Task<bool>>? WriteApproval = null,
    /// <summary>repo.log 单次返回上限。</summary>
    int LogLimit = 20);

/// <summary>
/// Gitter 内置 MCP server 的工具层（ai-native-redesign.md §7.2）：把本仓库的 git 能力
/// 以结构化工具暴露给本机任意 agent。传输为 stdio 按行 JSON-RPC（MCP 规范），
/// <see cref="Handle"/> 纯同步、可注入任意文本流测试。
///
/// 工具集（只读优先）：repo.status / repo.log / repo.diff / repo.branches / repo.worktrees；
/// 写工具 repo.stage / repo.commit 仅在 <see cref="McpServerOptions.AllowWrites"/> 时可用；
/// review.submit_feedback 持久化 agent→人的反馈（.git/gitter/feedback.json，元数据非 git 写）。
/// </summary>
public sealed class GitterMcpServer
{
    public const string FeedbackTool = "review.submit_feedback";

    private readonly IRepositoryService _repo;
    private readonly string _workDir;
    private readonly McpServerOptions _options;

    public GitterMcpServer(IRepositoryService repo, string workDir, McpServerOptions? options = null)
    {
        _repo = repo ?? throw new ArgumentNullException(nameof(repo));
        _workDir = workDir ?? throw new ArgumentNullException(nameof(workDir));
        _options = options ?? new McpServerOptions();
    }

    /// <summary>处理一行 JSON-RPC 请求；通知（无 id）返回 null。</summary>
    public async Task<string?> HandleAsync(string line)
    {
        var msg = JsonRpcMessage.Parse(line);
        if (!msg.IsValid)
            return JsonRpc.Error(null, msg.ErrorCode, msg.ErrorMessage ?? "invalid");
        if (!msg.IsRequest) return null;
        if (msg.Id is null)
            return null; // notification（如 notifications/initialized）：无响应

        return msg.Method switch
        {
            "initialize" => JsonRpc.Result(msg.Id, new
            {
                protocolVersion = "2024-11-05",
                capabilities = new { tools = new { } },
                serverInfo = new { name = "gitter", version = "0.1.0" },
            }),
            "tools/list" => JsonRpc.Result(msg.Id, new { tools = ToolList() }),
            "tools/call" => await HandleToolCallAsync(msg),
            "ping" => JsonRpc.Result(msg.Id, new { }),
            _ => JsonRpc.Error(msg.Id, -32601, $"Method not found: {msg.Method}"),
        };
    }

    // ---- 工具描述 ----

    private static IEnumerable<object> ToolList()
    {
        yield return Obj(("name", "repo.status"), ("description", "Working tree status: changed/staged/untracked/conflict files."));
        yield return Obj(("name", "repo.log"), ("description", "Recent commits (sha, subject, author, date, ai agent). Optional: limit."));
        yield return Obj(("name", "repo.diff"), ("description", "Patch of staged changes vs HEAD (or one file). Optional: path."));
        yield return Obj(("name", "repo.branches"), ("description", "Local and remote branches."));
        yield return Obj(("name", "repo.worktrees"), ("description", "All worktrees of this repository."));
        yield return Obj(("name", "repo.stage"), ("description", "Stage files (git add -A). Requires write permission."));
        yield return Obj(("name", "repo.commit"), ("description", "Commit staged changes with a message. Requires write permission."));
        yield return Obj(("name", FeedbackTool), ("description", "Submit human review feedback about a hunk/file to be picked up by the person in Gitter. Params: note (required), path (optional)."));
    }

    // ---- tools/call 分发 ----

    private async Task<string> HandleToolCallAsync(JsonRpcMessage msg)
    {
        string? name = null;
        try
        {
            if (msg.Params.ValueKind != JsonValueKind.Object
                || !msg.Params.TryGetProperty("name", out var nameEl)
                || nameEl.ValueKind != JsonValueKind.String)
                return JsonRpc.Error(msg.Id, -32602, "tools/call requires params.name");
            name = nameEl.GetString();
            var args = msg.Params.TryGetProperty("arguments", out var a) && a.ValueKind == JsonValueKind.Object ? a : default;

            var result = name switch
            {
                "repo.status" => ToolStatus(),
                "repo.log" => ToolLog(args),
                "repo.diff" => ToolDiff(args),
                "repo.branches" => ToolBranches(),
                "repo.worktrees" => ToolWorktrees(),
                "repo.stage" => await ToolStageAsync(args),
                "repo.commit" => await ToolCommitAsync(args),
                FeedbackTool => ToolFeedback(args),
                _ => null,
            };
            return result is null
                ? JsonRpc.Error(msg.Id, -32602, $"Unknown tool: {name}")
                : JsonRpc.Result(msg.Id, new { content = new[] { new { type = "text", text = result } } });
        }
        catch (Exception ex)
        {
            // 工具执行失败以 MCP 约定的 isError 内容返回（不是协议错误）
            return JsonRpc.Result(msg.Id, new
            {
                content = new[] { new { type = "text", text = ex.Message.Length <= 300 ? ex.Message : ex.Message[..300] } },
                isError = true,
            });
        }
    }

    // ---- 各工具实现 ----

    private string ToolStatus()
    {
        var status = _repo.GetStatus(_workDir);
        var lines = status.Select(s => $"{s.Category}: {s.Path} (+{s.AddedLines ?? 0}/-{s.DeletedLines ?? 0})");
        return status.Count == 0 ? "clean" : string.Join('\n', lines);
    }

    private string ToolLog(JsonElement args)
    {
        var limit = GetInt(args, "limit") ?? _options.LogLimit;
        var page = _repo.GetLog(_workDir, new LogFilter(Limit: Math.Clamp(limit, 1, 200)));
        var lines = page.Items.Select(c =>
        {
            var meta = CommitTrailers.Read(c.Message);
            var agent = meta.AssistedBy is null ? "" : $" [ai:{meta.AssistedBy}]";
            return $"{c.ShortSha} {c.CommitterDate:yyyy-MM-dd HH:mm} {c.Author}: {c.Subject}{agent}";
        });
        return string.Join('\n', lines) + $"\n({page.Items.Count}/{page.TotalCount})";
    }

    private string ToolDiff(JsonElement args)
    {
        var path = GetString(args, "path");
        if (path is not null)
            return _repo.GetIndexPatch(_workDir, path) ?? $"(no staged diff for {path})";
        // 全量：逐 staged 文件拼接（有上限保护）
        var status = _repo.GetStatus(_workDir).Where(s => s.Category == StatusCategory.Staged).Take(50).ToList();
        if (status.Count == 0) return "(nothing staged)";
        var sb = new System.Text.StringBuilder();
        foreach (var s in status)
        {
            var patch = _repo.GetIndexPatch(_workDir, s.Path);
            if (patch is not null) sb.AppendLine(patch);
        }
        return sb.Length == 0 ? "(nothing staged)" : sb.ToString();
    }

    private string ToolBranches()
    {
        var branches = _repo.GetBranches(_workDir);
        var lines = branches.Select(b => $"{(b.IsRemote ? "remote" : "local ")} {(b.IsHead ? "*" : " ")} {b.Name}");
        return string.Join('\n', lines);
    }

    private string ToolWorktrees()
    {
        var worktrees = _repo.GetWorktrees(_workDir);
        return string.Join('\n', worktrees.Select(w =>
            $"{(w.IsMain ? "main " : "task ")} {w.DisplayName,-20} {w.Path}"));
    }

    private async Task<string> ToolStageAsync(JsonElement args)
    {
        var paths = GetStringArray(args, "paths");
        if (paths is null || paths.Length == 0) return "paths[] required";
        if (!await ApprovalGateAsync($"git add {paths.Length} 个文件（{string.Join(", ", paths.Take(3))}{(paths.Length > 3 ? " …" : "")}）"))
            return Denied();
        _repo.Stage(_workDir, paths);
        return $"staged {paths.Length} file(s)";
    }

    private async Task<string> ToolCommitAsync(JsonElement args)
    {
        var message = GetString(args, "message");
        if (string.IsNullOrWhiteSpace(message)) return "message required";
        if (!await ApprovalGateAsync($"git commit：{TrimOneLine(message)}"))
            return Denied();
        var sha = _repo.Commit(_workDir, message);
        return $"committed {sha[..Math.Min(7, sha.Length)]}";
    }

    /// <summary>
    /// 写权限门（原则 1.2-2）：显式信任模式（AllowWrites）直通；否则走人审回调
    /// （无回调 = 拒绝）。回调异常按拒绝处理，不让 agent 侧故障绕过确认。
    /// </summary>
    private async Task<bool> ApprovalGateAsync(string description)
    {
        if (_options.AllowWrites) return true;
        if (_options.WriteApproval is null) return false;
        try { return await _options.WriteApproval(description).ConfigureAwait(false); }
        catch { return false; }
    }

    private static string TrimOneLine(string message)
    {
        var firstLine = message.Trim().Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries) is { Length: > 0 } lines
            ? lines[0]
            : string.Empty;
        return firstLine.Length <= 80 ? firstLine : firstLine[..80];
    }

    private string ToolFeedback(JsonElement args)
    {
        var note = GetString(args, "note");
        if (string.IsNullOrWhiteSpace(note)) return "note required";
        var path = GetString(args, "path");
        AgentFeedbackStore.Write(_workDir, note, path);
        return "feedback recorded; the person will see it in Gitter's Changes page.";
    }

    private static string Denied() =>
        "write tools are disabled; start Gitter's MCP server with write permission or perform git writes yourself.";

    // ---- 小工具 ----

    private static string? GetString(JsonElement args, string name) =>
        args.ValueKind == JsonValueKind.Object
            && args.TryGetProperty(name, out var el)
            && el.ValueKind == JsonValueKind.String
                ? el.GetString()
                : null;

    private static int? GetInt(JsonElement args, string name) =>
        args.ValueKind == JsonValueKind.Object
            && args.TryGetProperty(name, out var el)
            && el.ValueKind == JsonValueKind.Number
                ? el.GetInt32()
                : null;

    private static string[]? GetStringArray(JsonElement args, string name)
    {
        if (args.ValueKind != JsonValueKind.Object || !args.TryGetProperty(name, out var el)
            || el.ValueKind != JsonValueKind.Array) return null;
        return el.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String)
            .Select(x => x.GetString()!).ToArray();
    }

    private static object Obj(params (string Key, object Value)[] pairs)
    {
        var dict = new Dictionary<string, object>();
        foreach (var (k, v) in pairs) dict[k] = v;
        return dict;
    }
}

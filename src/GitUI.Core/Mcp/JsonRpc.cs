using System.Text.Json;

namespace GitUI.Core.Mcp;

/// <summary>一条 JSON-RPC 2.0 消息的解析结果（MCP stdio：按行分隔的 JSON）。</summary>
public sealed record JsonRpcMessage(
    bool IsValid,
    bool IsRequest,
    string? Id,
    string? Method,
    JsonElement Params,
    int ErrorCode,
    string? ErrorMessage)
{
    public bool IsNotification => IsValid && IsRequest && Id is null;

    public static JsonRpcMessage Parse(string? line)
    {
        if (string.IsNullOrWhiteSpace(line)) return Invalid(-32700, "Parse error: empty line");
        try
        {
            using var doc = JsonDocument.Parse(line);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return Invalid(-32600, "Invalid Request: not an object");

            var id = root.TryGetProperty("id", out var idEl) ? IdToString(idEl) : null;
            var method = root.TryGetProperty("method", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() : null;

            if (method is null) return Invalid(-32600, "Invalid Request: missing method");

            var paramsEl = root.TryGetProperty("params", out var p) ? p : default;
            return new JsonRpcMessage(true, IsRequest: true, id, method,
                paramsEl.ValueKind == JsonValueKind.Undefined ? default : paramsEl.Clone(), 0, null);
        }
        catch (JsonException ex)
        {
            return Invalid(-32700, "Parse error: " + ex.Message);
        }
    }

    private static JsonRpcMessage Invalid(int code, string message) =>
        new(false, false, null, null, default, code, message);

    private static string? IdToString(JsonElement id) => id.ValueKind switch
    {
        JsonValueKind.String => id.GetString(),
        JsonValueKind.Number => id.GetRawText(),
        _ => null, // null id = notification
    };
}

/// <summary>JSON-RPC 响应构造（成功 / 错误）。</summary>
public static class JsonRpc
{
    public static string Result(string? id, object result)
    {
        var idNode = id is null ? "null" : JsonSerializer.Serialize(id);
        return $"{{\"jsonrpc\":\"2.0\",\"id\":{idNode},\"result\":{JsonSerializer.Serialize(result)}}}";
    }

    public static string Error(string? id, int code, string message)
    {
        var idNode = id is null ? "null" : JsonSerializer.Serialize(id);
        return $"{{\"jsonrpc\":\"2.0\",\"id\":{idNode},\"error\":{{\"code\":{code},\"message\":{JsonSerializer.Serialize(message)}}}}}";
    }
}

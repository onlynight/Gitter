using System.Text.Json;
using System.Text.RegularExpressions;
using System.Text.Json.Serialization;

namespace GitUI.Diff.Highlighting;

/// <summary>
/// TextMate 兼容子集（code-highlight-framework.md P4b）：加载 JSON 形态 tmLanguage 的受限子集——
/// patterns（match/name、match/captures、begin/end/name、include #repository）、repository、fileTypes。
/// 已知子集边界：Oniguruma 专有构造编译失败该规则跳过；嵌套 begin/end 内 patterns 不递归求值（扁平近似）；
/// captures 仅取组 1 的 scope 作为样式来源。
///
/// scope → 语义样式键映射（取 scope 首段/前缀）：
///   comment→comment · string→string · keyword→keyword · constant.numeric→number ·
///   entity.name.function→function · entity.name.type / support.type→type · variable→variable
/// 未映射 scope → plain。
/// </summary>
public static class TextMateSubset
{
    private sealed class TmPattern
    {
        [JsonPropertyName("include")] public string? Include { get; set; }
        [JsonPropertyName("match")] public string? Match { get; set; }
        [JsonPropertyName("name")] public string? Name { get; set; }
        [JsonPropertyName("begin")] public string? Begin { get; set; }
        [JsonPropertyName("end")] public string? End { get; set; }
        [JsonPropertyName("contentName")] public string? ContentName { get; set; }
        [JsonPropertyName("captures")] public Dictionary<string, TmScope>? Captures { get; set; }
        [JsonPropertyName("patterns")] public List<TmPattern>? Patterns { get; set; }
    }

    private sealed class TmScope
    {
        [JsonPropertyName("name")] public string? Name { get; set; }
    }

    private sealed class TmLanguageDoc
    {
        [JsonPropertyName("name")] public string? Name { get; set; }
        [JsonPropertyName("fileTypes")] public List<string>? FileTypes { get; set; }
        [JsonPropertyName("patterns")] public List<TmPattern>? Patterns { get; set; }
        [JsonPropertyName("repository")] public Dictionary<string, TmPattern>? Repository { get; set; }
    }

    private const int MaxIncludeDepth = 32;

    /// <summary>从 tmLanguage JSON 构建声明式高亮器；无 fileTypes 或无可用规则返回 null。</summary>
    public static DeclarativeHighlighter? Load(string json, string fallbackId)
    {
        TmLanguageDoc? doc;
        try
        {
            doc = JsonSerializer.Deserialize<TmLanguageDoc>(json, new JsonSerializerOptions
            {
                ReadCommentHandling = JsonCommentHandling.Skip,
                AllowTrailingCommas = true,
            });
        }
        catch (JsonException)
        {
            return null;
        }

        if (doc?.Patterns is null || doc.FileTypes is null || doc.FileTypes.Count == 0)
        {
            return null;
        }

        var extensions = doc.FileTypes
            .Where(t => !string.IsNullOrWhiteSpace(t))
            .Select(t => t.StartsWith('.') ? t : "." + t)
            .ToList();
        if (extensions.Count == 0)
        {
            return null;
        }

        var rules = new List<(string Style, Regex Pattern)>();
        var blocks = new List<DeclarativeHighlighter.BlockRule>();
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var id = !string.IsNullOrWhiteSpace(doc.Name) ? doc.Name : fallbackId;
        CompilePatterns(doc.Patterns, doc.Repository, rules, blocks, visited, depth: 0);

        return DeclarativeHighlighter.Create(
            id: id,
            language: id,
            extensions: extensions,
            rules: rules,
            blockRules: blocks);
    }

    private static void CompilePatterns(
        List<TmPattern>? patterns,
        Dictionary<string, TmPattern>? repository,
        List<(string Style, Regex Pattern)> rules,
        List<DeclarativeHighlighter.BlockRule> blocks,
        HashSet<string> visited,
        int depth)
    {
        if (patterns is null || depth > MaxIncludeDepth)
        {
            return; // include 环/超深：子集边界，直接截断
        }

        foreach (var p in patterns)
        {
            if (p.Include is not null)
            {
                // 子集：仅支持 #repository 引用（外部语法引用跳过）
                if (p.Include.StartsWith('#') && repository is not null
                    && repository.TryGetValue(p.Include[1..], out var target))
                {
                    var key = "#" + p.Include[1..];
                    if (visited.Add(key))
                    {
                        try
                        {
                            // 引用的目标模式自身的 match/begin 展开；其嵌套 patterns 展开在其后
                            CompilePatterns(new List<TmPattern> { target }, repository, rules, blocks, visited, depth + 1);
                        }
                        finally
                        {
                            visited.Remove(key);
                        }

                        CompilePatterns(target.Patterns, repository, rules, blocks, visited, depth + 1);
                    }
                }

                continue;
            }

            if (p.Begin is not null && p.End is not null)
            {
                var style = ScopeToStyle(p.Name ?? p.ContentName);
                if (style is not null)
                {
                    blocks.Add(new DeclarativeHighlighter.BlockRule(style, new Regex(p.Begin, RegexOptions.Compiled), new Regex(p.End, RegexOptions.Compiled)));
                }

                continue;
            }

            if (p.Match is not null)
            {
                var scope = p.Name ?? p.Captures?.Values.FirstOrDefault(v => v.Name is not null)?.Name;
                var style = ScopeToStyle(scope);
                if (style is not null)
                {
                    try
                    {
                        rules.Add((style, new Regex(p.Match, RegexOptions.Compiled)));
                    }
                    catch (ArgumentException)
                    {
                        // Oniguruma 专有构造不可编译 → 跳过该规则
                    }
                }

                CompilePatterns(p.Patterns, repository, rules, blocks, visited, depth + 1);
            }
        }
    }

    /// <summary>scope → 语义样式键；未映射 scope 返回 null（plain）。</summary>
    public static string? ScopeToStyle(string? scope)
    {
        if (string.IsNullOrWhiteSpace(scope))
        {
            return null;
        }

        var s = scope.Trim();
        if (s.StartsWith("comment", StringComparison.Ordinal)) return "comment";
        if (s.StartsWith("string", StringComparison.Ordinal)) return "string";
        if (s.StartsWith("constant.numeric", StringComparison.Ordinal)) return "number";
        if (s.StartsWith("entity.name.function", StringComparison.Ordinal)) return "function";
        if (s.StartsWith("entity.name.type", StringComparison.Ordinal) || s.StartsWith("support.type", StringComparison.Ordinal)) return "type";
        if (s.StartsWith("variable", StringComparison.Ordinal)) return "variable";
        if (s.StartsWith("keyword", StringComparison.Ordinal) || s.StartsWith("storage", StringComparison.Ordinal)) return "keyword";
        return null;
    }
}

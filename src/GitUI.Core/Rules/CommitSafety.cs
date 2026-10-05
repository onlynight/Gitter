using System.Globalization;
using System.Text.RegularExpressions;
using GitUI.Core.Resources;

namespace GitUI.Core.Rules;

/// <summary>发现问题的严重级别。Blocked 级在 Block 模式下拦截提交；Warning 仅提示。</summary>
public enum SafetySeverity
{
    Warning = 0,
    Blocked = 1,
}

/// <summary>单条规则命中：文件 + 行号（1 基，patch 可解析时）+ 规则 id + 文案。</summary>
public sealed record RuleFinding(
    string RuleId,
    SafetySeverity Severity,
    string FilePath,
    int? Line,
    string Message);

/// <summary>
/// 一个待提交文件的扫描输入。Patch 为该文件 index vs HEAD 的 unified diff
/// （GetIndexPatch 产物；null = 无差异或取不到）；规则只看新增行（"+" 开头）。
/// </summary>
public sealed record StagedFileInput(
    string Path,
    string? Patch,
    bool IsBinary,
    bool IsNew,
    int AddedLines,
    int DeletedLines);

/// <summary>扫描参数（ai-native-redesign.md §4.2：阻止 / 警告 / 关闭三档由调用方按 Mode 解释）。</summary>
public sealed record CommitSafetyOptions(
    int LargeFileAddedLineThreshold = 2000,
    IReadOnlyList<string>? ExemptPaths = null)
{
    public static CommitSafetyOptions Default { get; } = new();
}

/// <summary>
/// 提交前安全网规则引擎（ai-native-redesign.md §4.2 / §3.3 共用规则库）。
/// 纯函数、零 AI 依赖：AI 不可用时安全网照常工作（设计原则 1.2-3）。
///
/// 首发规则（AI 编程高频事故清单）：
/// - secret.leak     secrets 泄露（密钥/token/私钥模式，命中即 Blocked 级）
/// - debug.residue   调试输出残留（按语言，Warning）
/// - large.file      新增行数超阈值的大文件（Warning）
/// - binary.incoming 二进制文件入库（Warning）
/// </summary>
public static partial class CommitSafetyScanner
{
    public const string RuleSecret = "secret.leak";
    public const string RuleDebug = "debug.residue";
    public const string RuleLargeFile = "large.file";
    public const string RuleBinary = "binary.incoming";

    // ---- secrets：只匹配新增行，忽略 env 读取 / 占位符等常见误报 ----

    [GeneratedRegex(@"AKIA[0-9A-Z]{16}", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex AwsAccessKey();

    [GeneratedRegex(@"-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY( BLOCK)?-----", RegexOptions.CultureInvariant)]
    private static partial Regex PrivateKeyHeader();

    [GeneratedRegex(@"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b", RegexOptions.CultureInvariant)]
    private static partial Regex GitHubToken();

    [GeneratedRegex(@"\bxox[baprs]-[A-Za-z0-9-]{10,}\b", RegexOptions.CultureInvariant)]
    private static partial Regex SlackToken();

    [GeneratedRegex(@"\bsk-(?:ant-)?(?:proj-)?[A-Za-z0-9_-]{20,}\b", RegexOptions.CultureInvariant)]
    private static partial Regex AnthropicOrOpenAiKey();

    [GeneratedRegex(@"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}", RegexOptions.CultureInvariant)]
    private static partial Regex JwtToken();

    /// <summary>key/value 形态的明文密钥赋值；右侧排除 env 读取、占位符、模板插值、空值。</summary>
    [GeneratedRegex(
        @"(?:api[_-]?key|secret|token|password|passwd|pwd)[""']?\s*[:=]\s*[""']?(?<value>[^""'\r\n]{8,})",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex KeyValueSecret();

    /// <summary>右侧值若像"读环境变量/配置/占位符"则不算泄露。</summary>
    [GeneratedRegex(
        @"(?:process\.env|os\.environ|ENV\[|getenv|Environment\.GetEnvironmentVariable|Configuration|appsettings|<[^>]*>|\{\{|\$\{|\$\(|%\(|\*+|x{3,}|XXXX|PLACEHOLDER|YOUR[_A-Z]|changeme|example|dummy|localhost|127\.0\.0\.1)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex SecretValuePlaceholder();

    // ---- 调试残留：按扩展名路由（ai-native-redesign.md §8.3 高亮元数据思路的最小版） ----

    private static readonly (string[] Exts, Regex Pattern)[] DebugPatterns =
    {
        (new[] { ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs" },
         new Regex(@"\bconsole\.(?:log|debug)\s*\(|\bdebugger\s*;", RegexOptions.Compiled)),
        (new[] { ".cs" },
         new Regex(@"System\.Diagnostics\.Debug\.WriteLine\s*\(", RegexOptions.Compiled)),
        (new[] { ".py" },
         new Regex(@"\bbreakpoint\s*\(\s*\)", RegexOptions.Compiled)),
        (new[] { ".rs" },
         new Regex(@"\bdbgi?\s*!", RegexOptions.Compiled)),
    };

    /// <summary>扫描全部文件。返回按严重级降序（Blocked 在前）的发现列表。</summary>
    public static IReadOnlyList<RuleFinding> Scan(
        IReadOnlyList<StagedFileInput> files,
        CommitSafetyOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(files);
        var opts = options ?? CommitSafetyOptions.Default;
        var findings = new List<RuleFinding>();

        foreach (var file in files)
        {
            if (IsExempt(file.Path, opts.ExemptPaths)) continue;

            if (file.IsBinary)
            {
                if (file.IsNew)
                    findings.Add(new RuleFinding(RuleBinary, SafetySeverity.Warning, file.Path, null,
                        Strings.Rules_BinaryIncoming));
                continue; // 二进制文件不做文本规则
            }

            ScanPatch(file, findings);

            if (file.IsNew && file.AddedLines >= opts.LargeFileAddedLineThreshold)
                findings.Add(new RuleFinding(RuleLargeFile, SafetySeverity.Warning, file.Path, null,
                    string.Format(Strings.Rules_LargeFile, file.AddedLines, opts.LargeFileAddedLineThreshold)));
        }

        return findings
            .OrderByDescending(f => f.Severity)
            .ThenBy(f => f.FilePath, StringComparer.Ordinal)
            .ThenBy(f => f.Line ?? 0)
            .ToList();
    }

    private static void ScanPatch(StagedFileInput file, List<RuleFinding> findings)
    {
        if (string.IsNullOrEmpty(file.Patch)) return;

        var lines = file.Patch.Split('\n');
        var newLineNo = 0;
        var inHunk = false;

        foreach (var raw in lines)
        {
            var line = raw.TrimEnd('\r');
            if (line.StartsWith("@@", StringComparison.Ordinal))
            {
                inHunk = true;
                newLineNo = ParseNewStart(line);
                continue;
            }
            if (!inHunk) continue; // ---/+++ 头与 diff --git 行
            if (line.StartsWith('-')) continue;
            if (line.StartsWith('+'))
            {
                var content = line[1..];
                ScanAddedLine(file.Path, content, newLineNo, findings);
                newLineNo++;
            }
            else if (line.Length > 0)
            {
                newLineNo++; // 上下文行
            }
        }
    }

    private static void ScanAddedLine(string path, string content, int lineNo, List<RuleFinding> findings)
    {
        var trimmed = content.TrimStart();

        // 注释行不算泄露/残留（文档示例、被注释掉的调试行）
        if (trimmed.StartsWith("//") || trimmed.StartsWith('#') || trimmed.StartsWith("/*") || trimmed.StartsWith("*"))
            return;

        if (PrivateKeyHit(content))
        {
            findings.Add(new RuleFinding(RuleSecret, SafetySeverity.Blocked, path, lineNo, Strings.Rules_PrivateKey));
            return;
        }
        if (AwsAccessKey().IsMatch(content) || GitHubToken().IsMatch(content) || SlackToken().IsMatch(content)
            || AnthropicOrOpenAiKey().IsMatch(content) || JwtToken().IsMatch(content))
        {
            findings.Add(new RuleFinding(RuleSecret, SafetySeverity.Blocked, path, lineNo, Strings.Rules_SecretToken));
            return;
        }
        var kv = KeyValueSecret().Match(content);
        if (kv.Success && !SecretValuePlaceholder().IsMatch(kv.Groups["value"].Value))
        {
            findings.Add(new RuleFinding(RuleSecret, SafetySeverity.Blocked, path, lineNo, Strings.Rules_SecretAssignment));
            return;
        }

        var ext = Path.GetExtension(path);
        foreach (var (exts, pattern) in DebugPatterns)
        {
            if (!exts.Contains(ext, StringComparer.OrdinalIgnoreCase)) continue;
            if (pattern.IsMatch(content))
                findings.Add(new RuleFinding(RuleDebug, SafetySeverity.Warning, path, lineNo, Strings.Rules_DebugResidue));
            break; // 扩展名只属于一组
        }
    }

    private static bool PrivateKeyHit(string content) =>
        content.TrimStart().StartsWith("-----BEGIN", StringComparison.Ordinal) && PrivateKeyHeader().IsMatch(content);

    /// <summary>解析 "@@ -1,3 +2,4 @@" 的新侧起始行；解析失败返回 1。</summary>
    private static int ParseNewStart(string hunkHeader)
    {
        var match = Regex.Match(hunkHeader, @"\+(\d+)", RegexOptions.CultureInvariant);
        return match.Success && int.TryParse(match.Groups[1].Value, out var n) ? n : 1;
    }

    /// <summary>
    /// 豁免路径匹配：精确相等 / 目录前缀（"dir/"）/ 通配 "*"（跨路径段，如 "*.min.js"、"secrets/*"）。
    /// </summary>
    public static bool IsExempt(string path, IReadOnlyList<string>? exemptPaths)
    {
        if (exemptPaths is null || exemptPaths.Count == 0) return false;
        foreach (var raw in exemptPaths)
        {
            if (string.IsNullOrWhiteSpace(raw)) continue;
            var pattern = raw.Replace('\\', '/').TrimEnd('/');
            var p = path.Replace('\\', '/');
            if (p.Equals(pattern, StringComparison.OrdinalIgnoreCase)) return true;
            if (pattern.EndsWith('/') || raw.EndsWith('/') || raw.EndsWith('\\'))
            {
                if (p.StartsWith(pattern + "/", StringComparison.OrdinalIgnoreCase)) return true;
            }
            if (pattern.Contains('*', StringComparison.Ordinal))
            {
                var regex = "^" + Regex.Escape(pattern).Replace(@"\*", ".*") + "$";
                if (Regex.IsMatch(p, regex, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)) return true;
            }
            else if (p.StartsWith(pattern + "/", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }
        return false;
    }
}

/// <summary>扫描结果摘要：调用方按 SafetyNetMode 解释（Block 模式有 Blocked 级即拦截）。</summary>
public static class CommitSafetySummarizer
{
    public static IReadOnlyList<RuleFinding> Blocking(IReadOnlyList<RuleFinding> findings) =>
        findings.Where(f => f.Severity == SafetySeverity.Blocked).ToList();
}

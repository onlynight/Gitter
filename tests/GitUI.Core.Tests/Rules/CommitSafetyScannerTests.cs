using GitUI.Core.Rules;
using Xunit;

namespace GitUI.Core.Tests.Rules;

/// <summary>
/// 提交前安全网规则引擎（ai-native-redesign.md §4.2）：secrets/调试残留/大文件/二进制、
/// 只看新增行、豁免路径、排序。
/// </summary>
public sealed class CommitSafetyScannerTests
{
    private static IReadOnlyList<RuleFinding> ScanOne(
        string path, string patch, bool isNew = false, int added = 0, int deleted = 0,
        CommitSafetyOptions? options = null)
        => CommitSafetyScanner.Scan(
            new[] { new StagedFileInput(path, patch, IsBinary: false, IsNew: isNew, added, deleted) },
            options);

    private static string Patch(params string[] addedLines) =>
        "@@ -1,1 +1," + addedLines.Length + " @@\n" + string.Join("\n", addedLines.Select(l => "+" + l));

    // ---- secrets：命中即 Blocked ----

    [Theory]
    [InlineData("key = AKIAIOSFODNN7EXAMPLE")]
    [InlineData("token: ghp_0123456789abcdefghij0123456789abcd")]
    [InlineData("auth = eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U")]
    [InlineData("xoxb-123456789-abcdef")]
    [InlineData("-----BEGIN RSA PRIVATE KEY-----")]
    public void SecretPatterns_InAddedLine_AreBlocked(string addedLine)
    {
        var findings = ScanOne("app.config", Patch(" const x = 1;", addedLine));
        var secret = findings.Single(f => f.RuleId == CommitSafetyScanner.RuleSecret);
        Assert.Equal(SafetySeverity.Blocked, secret.Severity);
        Assert.True(secret.Line >= 1);
    }

    [Theory]
    [InlineData("apiKey: process.env.API_KEY")]
    [InlineData("password = os.environ['PWD']")]
    [InlineData("token = ${TOKEN_FROM_ENV}")]
    [InlineData("api_key = \"xxxx\"")]
    [InlineData("apiKey = YOUR_API_KEY_HERE")]
    [InlineData("password: <from-vault>")]
    public void SecretPlaceholders_AreNotFlagged(string addedLine)
    {
        var findings = ScanOne("app.config", Patch(addedLine));
        Assert.DoesNotContain(findings, f => f.RuleId == CommitSafetyScanner.RuleSecret);
    }

    [Fact]
    public void KeyValueSecret_WithLiteralValue_IsBlocked()
    {
        var findings = ScanOne("settings.py", Patch("API_KEY = \"sk-live-abcdef123456\""));
        Assert.Contains(findings, f => f.RuleId == CommitSafetyScanner.RuleSecret && f.Severity == SafetySeverity.Blocked);
    }

    // ---- 只看新增行 ----

    [Fact]
    public void RemovedAndContextLines_AreIgnored()
    {
        var patch = "@@ -1,3 +1,3 @@\n context with AKIAIOSFODNN7EXAMPLE\n-secret = ghp_0123456789abcdefghij0123456789abcd\n+clean line";
        var findings = ScanOne("f.txt", patch);
        Assert.Empty(findings);
    }

    [Fact]
    public void CommentLines_AreIgnored()
    {
        var findings = ScanOne("f.js", Patch("// console.log(\")", "# password = hunter2000x"));
        Assert.Empty(findings);
    }

    // ---- 调试残留：按扩展名 ----

    [Fact]
    public void ConsoleLog_InJsFile_IsDebugResidue()
    {
        var findings = ScanOne("app.js", Patch("console.log('dbg', x);"));
        var residue = findings.Single();
        Assert.Equal(CommitSafetyScanner.RuleDebug, residue.RuleId);
        Assert.Equal(SafetySeverity.Warning, residue.Severity);
    }

    [Fact]
    public void ConsoleLog_InMarkdown_IsNotFlagged()
    {
        var findings = ScanOne("README.md", Patch("console.log('example'));"));
        Assert.Empty(findings);
    }

    [Fact]
    public void DebuggerAndDbgAndBreakpoint_AreFlagged()
    {
        Assert.NotEmpty(ScanOne("a.ts", Patch("debugger;")));
        Assert.NotEmpty(ScanOne("b.rs", Patch("let v = dbg!(x);")));
        Assert.NotEmpty(ScanOne("c.py", Patch("breakpoint()")));
        Assert.NotEmpty(ScanOne("d.cs", Patch("System.Diagnostics.Debug.WriteLine(x);")));
    }

    // ---- 大文件 / 二进制 ----

    [Fact]
    public void LargeNewFile_IsWarning()
    {
        var findings = CommitSafetyScanner.Scan(new[]
        {
            new StagedFileInput("big.json", "{}", IsBinary: false, IsNew: true, AddedLines: 3000, DeletedLines: 0),
        });
        Assert.Contains(findings, f => f.RuleId == CommitSafetyScanner.RuleLargeFile && f.Severity == SafetySeverity.Warning);
    }

    [Fact]
    public void LargeModifiedFile_NotFlagged()
    {
        var findings = CommitSafetyScanner.Scan(
            new[] { new StagedFileInput("big.json", "{}", IsBinary: false, IsNew: false, AddedLines: 3000, DeletedLines: 0) });
        Assert.DoesNotContain(findings, f => f.RuleId == CommitSafetyScanner.RuleLargeFile);
    }

    [Fact]
    public void BinaryNewFile_IsWarning_BinaryModified_IsNot()
    {
        var newFile = CommitSafetyScanner.Scan(new[]
        {
            new StagedFileInput("img.png", null, IsBinary: true, IsNew: true, 0, 0),
        });
        Assert.Contains(newFile, f => f.RuleId == CommitSafetyScanner.RuleBinary);

        var modified = CommitSafetyScanner.Scan(new[]
        {
            new StagedFileInput("img.png", null, IsBinary: true, IsNew: false, 0, 0),
        });
        Assert.DoesNotContain(modified, f => f.RuleId == CommitSafetyScanner.RuleBinary);
    }

    // ---- 豁免路径 ----

    [Theory]
    [InlineData("secrets/example.pem", "secrets/")]
    [InlineData("fixture.key", "fixture.key")]
    [InlineData("dist/app.min.js", "*.min.js")]
    public void ExemptPaths_SkipAllRules(string path, string exempt)
    {
        var findings = ScanOne(path, Patch("apiKey = AKIAIOSFODNN7EXAMPLE"),
            options: new CommitSafetyOptions(ExemptPaths: new[] { exempt }));
        Assert.Empty(findings);
    }

    // ---- 排序与空输入 ----

    [Fact]
    public void Findings_SortedBlockedFirst_ThenByPath()
    {
        var findings = CommitSafetyScanner.Scan(new[]
        {
            new StagedFileInput("z.js", Patch("console.log(1);"), IsBinary: false, IsNew: false, 1, 0),
            new StagedFileInput("a.txt", Patch("token = \"abc12345678\""), IsBinary: false, IsNew: false, 1, 0),
        });
        Assert.Equal(2, findings.Count);
        Assert.Equal(SafetySeverity.Blocked, findings[0].Severity);
        Assert.Equal("a.txt", findings[0].FilePath);
        Assert.Equal("z.js", findings[1].FilePath);
    }

    [Fact]
    public void EmptyInput_ReturnsEmpty()
    {
        Assert.Empty(CommitSafetyScanner.Scan(Array.Empty<StagedFileInput>()));
    }
}

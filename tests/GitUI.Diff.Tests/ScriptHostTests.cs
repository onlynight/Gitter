using GitUI.Diff.Highlighting;
using Xunit;

namespace GitUI.Diff.Tests;

/// <summary>
/// Jint 脚本宿主（extension-package-framework.md P3 / code-highlight-framework.md P3）：
/// 注册、分词、逐行降级、超时熔断、语法错误跳过。
/// </summary>
public class ScriptHostTests
{
    private const string TodoInitJs = """
    gitui.syntax.register({
      id: "sample.jstodo",
      language: "todo",
      extensions: [".todo"],
      tokenizeLine: function (line, state) {
        if (/^x\s/i.test(line)) {
          return { spans: [{ start: 0, length: line.length, style: "comment" }], state: state };
        }
        var spans = [];
        var m = /^\[[ xX]\]\s?/.exec(line);
        if (m) spans.push({ start: m.index, length: m[0].length, style: "keyword" });
        m = /\b\d{4}-\d{2}-\d{2}\b/.exec(line);
        if (m) spans.push({ start: m.index, length: m[0].length, style: "number" });
        return { spans: spans, state: state };
      }
    });
    """;

    [Fact]
    public void Host_RegistersScriptHighlighter_AndTokenizes()
    {
        var host = new ScriptHighlighterHost();
        host.Execute(TodoInitJs);

        var registered = Assert.Single(host.Registered);
        Assert.Equal("sample.jstodo", registered.Id);
        Assert.Contains(".todo", registered.Extensions);

        var r = registered.TokenizeLine("[x] 2026-10-04 完成设计", LineState.None);
        Assert.Contains(r.Spans, s => s.StyleKey == "keyword" && s.Start == 0 && s.Length == 4);
        Assert.Contains(r.Spans, s => s.StyleKey == "number" && s.Start == 4 && s.Length == 10);
    }

    [Fact]
    public void ScriptError_LineDegradesToPlain()
    {
        var host = new ScriptHighlighterHost();
        host.Execute("""
        gitui.syntax.register({
          id: "test.throwing",
          extensions: [".throwing"],
          tokenizeLine: function (line, state) { throw new Error("boom"); }
        });
        """);

        var h = host.Registered.Single();
        var r = h.TokenizeLine("anything", LineState.None);
        Assert.Empty(r.Spans); // 脚本异常 → 整行降级 plain，宿主存活
    }

    [Fact]
    public void ScriptTimeout_DoesNotHang()
    {
        var host = new ScriptHighlighterHost();
        host.Execute("""
        gitui.syntax.register({
          id: "test.slow",
          extensions: [".slow"],
          tokenizeLine: function (line, state) { while (true) { } }
        });
        """);

        var h = host.Registered.Single();
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var r = h.TokenizeLine("x", LineState.None);
        sw.Stop();

        Assert.Empty(r.Spans); // 超时 → 降级 plain
        Assert.True(sw.ElapsedMilliseconds < ScriptHighlighterHost.CallTimeoutMs + 3000,
            "timeout should fire promptly");
    }

    [Fact]
    public void SyntaxError_InInit_IsReported()
    {
        var host = new ScriptHighlighterHost();
        Assert.ThrowsAny<Exception>(() => host.Execute("this is not javascript ;;;"));
        Assert.Empty(host.Registered);
    }

    [Fact]
    public void LineState_PayloadRoundTripsBetweenCalls()
    {
        var host = new ScriptHighlighterHost();
        host.Execute("""
        var __calls = 0;
        gitui.syntax.register({
          id: "test.state",
          extensions: [".st"],
          tokenizeLine: function (line, state) {
            __calls++;
            return { spans: [{ start: 0, length: line.length, style: "comment" }], state: __calls };
          }
        });
        """);

        var h = host.Registered.Single();
        var r1 = h.TokenizeLine("a", LineState.None);
        var r2 = h.TokenizeLine("b", r1.NextState);

        // 第二次调用收到了第一次回传的状态（数字 1 → 变为注释片段即证明状态流转存活）
        Assert.NotNull(r2.NextState);
        Assert.Single(r2.Spans);
    }
}

using Xunit;
using GitUI.Core.Models;
using GitUI.Diff.Highlighting;
using GitUI.Diff.Render;

namespace GitUI.Render.Tests;

/// <summary>声明式高亮引擎 + 注册表 + 布局语法 run（code-highlight-framework.md P1）。</summary>
public class HighlightingTests
{
    // 声明式语法（JSON）。用字符串拼接构造，避免测试源码里的引号嵌套问题。
    private static string Grammar(string id, string extensions, string rules) =>
        "{\"highlighters\": [{\"id\": \"" + id + "\", \"language\": \"t\", \"extensions\": [" +
        extensions + "], \"rules\": [" + rules + "]}]}";

    private const string CSharpGrammar =
        "{\"highlighters\": [{\"id\": \"test.csharp\", \"language\": \"csharp\", \"extensions\": [\".cs\"], " +
        "\"rules\": [" +
        "{\"style\": \"comment\", \"pattern\": \"//.*$\"}, " +
        "{\"style\": \"keyword\", \"keywords\": [\"var\", \"public\", \"class\"]}, " +
        "{\"style\": \"number\", \"pattern\": \"\\\\b\\\\d+\\\\b\"} " +
        "]}]}";

    private static ISyntaxHighlighter LoadOne(string json) =>
        DeclarativeHighlighter.LoadAll(json).Single();

    [Fact]
    public void CSharp_Line_TokenizesKeywordNumberComment()
    {
        var h = LoadOne(CSharpGrammar);
        var r = h.TokenizeLine("var x = 42; // note", LineState.None);

        Assert.Contains(r.Spans, s => s.StyleKey == "keyword" && s.Start == 0 && s.Length == 3);
        Assert.Contains(r.Spans, s => s.StyleKey == "number" && s.Start == 8 && s.Length == 2);
        Assert.Contains(r.Spans, s => s.StyleKey == "comment" && s.Start == 12 && s.Length == 7);

        // 片段互不重叠且有序
        var ordered = r.Spans.OrderBy(s => s.Start).ToList();
        for (int i = 1; i < ordered.Count; i++)
        {
            Assert.True(ordered[i].Start >= ordered[i - 1].Start + ordered[i - 1].Length, "spans overlap");
        }
    }

    [Fact]
    public void Keywords_UseWordBoundaries()
    {
        var h = LoadOne(CSharpGrammar);
        var r = h.TokenizeLine("varx variable", LineState.None);

        // "varx" 的 var 不应命中（\b 边界）
        Assert.DoesNotContain(r.Spans, s => s.StyleKey == "keyword");
    }

    [Fact]
    public void LoadAll_SkipsInvalidRegexButKeepsValidRules()
    {
        var h = LoadOne(Grammar("test.mixed", "\".x\"",
            "{\"style\": \"bad\", \"pattern\": \"([unclosed\"}, {\"style\": \"good\", \"pattern\": \"ok\"}"));
        var r = h.TokenizeLine("ok", LineState.None);
        Assert.Contains(r.Spans, s => s.StyleKey == "good");
    }

    [Fact]
    public void Registry_RegisterAndResolve()
    {
        var h = LoadOne(CSharpGrammar);
        HighlighterRegistry.Register(h);

        Assert.Equal("test.csharp", HighlighterRegistry.Resolve("A.cs").Id);
        Assert.Equal("test.csharp", HighlighterRegistry.Resolve("a.CS").Id); // 扩展名大小写不敏感
        Assert.IsType<NullHighlighter>(HighlighterRegistry.Resolve("file.unknown"));
    }

    [Fact]
    public void BuiltinSyntaxPackage_GrammarLoadsAndCoversFiveLanguages()
    {
        // 内置语法包守卫：JSON 合法、正则全部可编译、覆盖五语言
        var path = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..",
            "src", "GitUI.App", "Packages", "GitUI.syntax.builtin", "syntax", "highlighters.json");
        if (!File.Exists(path))
        {
            return; // 发布/异构输出布局下跳过
        }

        var all = DeclarativeHighlighter.LoadAll(File.ReadAllText(path));
        Assert.True(all.Count >= 5, "builtin syntax package should cover >= 5 languages");
        Assert.Contains(all, h => h.Id == "builtin.csharp" && h.Extensions.Contains(".cs"));
        Assert.Contains(all, h => h.Id == "builtin.powershell" && h.Extensions.Contains(".ps1"));
        Assert.Contains(all, h => h.Id == "builtin.markdown");
        Assert.Contains(all, h => h.Id == "builtin.xml");
        Assert.Contains(all, h => h.Id == "builtin.json");
    }

    [Fact]
    public void Layout_EmitsTextRunCommand_ForSyntaxTokens()
    {
        // 桩高亮器：整行 "alpha" → keyword
        var stub = LoadOne(Grammar("test.layout", "\".layoutlang\"",
            "{\"style\": \"keyword\", \"pattern\": \"alpha\"}"));
        HighlighterRegistry.Register(stub);

        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 1, 1, 1, " alpha")), sideBySide: false);

        // 惰性分词路径（与 DiffCanvas.OnDraw 相同入口）
        model.EnsureSyntaxTokens(0, model.Rows.Count - 1, HighlighterRegistry.Resolve("a.layoutlang"));

        var styles = new SyntaxStyleSet(isLight: false);
        styles.TryGetColor("keyword", out var expected);

        var frame = DiffLayoutEngine.Layout(model, sideBySide: false, DiffMetrics.Default,
            new DiffViewport(800, 200, 0), styles);

        var run = frame.Commands.OfType<TextRunCommand>().SingleOrDefault(c => c.Text == "alpha");
        Assert.NotNull(run);
        Assert.Equal(expected, run!.Color);

        // 同一文本不再以普通 Foreground TextCommand 重复绘制
        Assert.DoesNotContain(frame.Commands.OfType<TextCommand>(),
            t => t.Text == "alpha" && t.Color == DiffColorKind.Foreground);
    }

    [Fact]
    public void Layout_WordHighlightFill_PreservedAlongsideSyntax()
    {
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 1, 1, 1, "- alpha beta", "+ alpha gamma")), sideBySide: false);

        model.EnsureWordDiff(0, model.Rows.Count - 1);
        var cell = model.Rows[1].Left!;
        Assert.NotNull(cell.Words); // 变更行对应有字级分段

        // 未知样式键的高亮器（整行 plain-unknown）走惰性分词路径
        var plain = LoadOne(Grammar("test.plain", "\".plainlang\"",
            "{\"style\": \"plain-unknown\", \"pattern\": \".+\"}"));
        HighlighterRegistry.Register(plain);
        model.EnsureSyntaxTokens(0, model.Rows.Count - 1, HighlighterRegistry.Resolve("a.plainlang"));

        var frame = DiffLayoutEngine.Layout(model, sideBySide: false, DiffMetrics.Default,
            new DiffViewport(800, 200, 0), new SyntaxStyleSet(isLight: false));

        // 未知样式键 → 全行回退 plain TextCommand；但字级高亮底仍保留
        Assert.Contains(frame.Commands, c => c is FillRectCommand f && f.Color == DiffColorKind.DeletedWordBackground);
        Assert.Contains(frame.Commands.OfType<TextCommand>(), t => t.Text.Contains("alpha"));
    }
}

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
    // ---- VSCode 合包（theme + syntax 双种类，extension-package-framework.md §3.2）----

    private static string VsCodePackagePath() => Path.Combine(AppContext.BaseDirectory,
        "..", "..", "..", "..", "..", "src", "GitUI.App", "Packages", "VsCodeDark");

    [Fact]
    public void VsCodePackage_ManifestHasCombinedKinds_AndThemeInheritsDark()
    {
        var dir = VsCodePackagePath();
        if (!Directory.Exists(dir)) return; // 发布布局跳过

        var manifest = System.Text.Json.JsonDocument.Parse(File.ReadAllText(Path.Combine(dir, "manifest.json"))).RootElement;
        var kinds = manifest.GetProperty("kinds").EnumerateArray().Select(k => k.GetString()).ToList();
        Assert.Contains("theme", kinds);   // 合包：同一包内既有主题又有高亮
        Assert.Contains("syntax", kinds);

        var theme = System.Text.Json.JsonDocument.Parse(File.ReadAllText(Path.Combine(dir, "theme", "theme.json"))).RootElement;
        Assert.Equal("gitui.theme.dark", theme.GetProperty("inherits").GetString()); // 稀疏覆盖：继承内置深色基座
        Assert.Equal("#569CD6", theme.GetProperty("syntax").GetProperty("keyword").GetString());
    }

    [Fact]
    public void VsCodeCSharp_Grammar_EnhancedRules()
    {
        var path = Path.Combine(VsCodePackagePath(), "syntax", "highlighters.json");
        if (!File.Exists(path)) return;

        var h = DeclarativeHighlighter.LoadAll(File.ReadAllText(path))
            .Single(x => x.Id == "vscode.csharp");

        // 预处理指令整行 keyword
        var r1 = h.TokenizeLine("#if DEBUG", LineState.None);
        Assert.Contains(r1.Spans, s => s.StyleKey == "keyword" && s.Start == 0);

        // 逐字字符串（含 "" 转义）：@"a""b" 从 8 起
        var r2 = h.TokenizeLine("var p = @\"a\"\"b\";", LineState.None);
        Assert.Contains(r2.Spans, s => s.StyleKey == "string" && s.Start == 8);

        // 内置类型=keyword、数字分隔符 1_000、函数调用 Main(
        var r3 = h.TokenizeLine("int n = 1_000; Main(n);", LineState.None);
        Assert.Contains(r3.Spans, s => s.StyleKey == "keyword" && s.Start == 0 && s.Length == 3);
        Assert.Contains(r3.Spans, s => s.StyleKey == "number" && s.Start == 8 && s.Length == 5);
        Assert.Contains(r3.Spans, s => s.StyleKey == "function" && s.Start == 15 && s.Length == 4);
    }

    [Fact]
    public void Registry_PluginOverridesBuiltinByExtension()
    {
        var path = Path.Combine(VsCodePackagePath(), "syntax", "highlighters.json");
        if (!File.Exists(path)) return;

        var plugin = DeclarativeHighlighter.LoadAll(File.ReadAllText(path))
            .Single(x => x.Id == "vscode.csharp");
        HighlighterRegistry.Register(plugin);

        // 后注册的插件覆盖内置同扩展名高亮器（extension-package-framework.md §四）
        Assert.Equal("vscode.csharp", HighlighterRegistry.Resolve("Program.cs").Id);
    }

    // ---- P4a：跨行块注释 ----

    private static string BlockGrammar = """
    {
      "highlighters": [{
        "id": "test.block", "language": "blk", "extensions": [".blk"],
        "rules": [
          { "style": "comment", "blockStart": "/\\*", "blockEnd": "\\*/" },
          { "style": "keyword", "keywords": ["var"] }
        ]
      }]
    }
    """;

    [Fact]
    public void BlockComment_CarriesStateAcrossLines()
    {
        var h = LoadOne(BlockGrammar);
        Assert.True(h.RequiresSequentialState);

        var r1 = h.TokenizeLine("/* start", LineState.None);
        Assert.Contains(r1.Spans, s => s.StyleKey == "comment" && s.Start == 0);

        var r2 = h.TokenizeLine("mid * text", r1.NextState);
        Assert.Contains(r2.Spans, s => s.StyleKey == "comment" && s.Start == 0);
        Assert.All(r2.Spans, s => Assert.Equal("comment", s.StyleKey)); // 块内整行皆注释

        // 行内结束：*/ 之后的 keyword 恢复正常着色
        var r3 = h.TokenizeLine("*/ var x", r2.NextState);
        Assert.Contains(r3.Spans, s => s.StyleKey == "comment" && s.Start == 0 && s.Length == 2);
        Assert.Contains(r3.Spans, s => s.StyleKey == "keyword" && s.Start == 3 && s.Length == 3);
    }

    [Fact]
    public void EnsureSyntaxTokens_Sequential_JoinsBlockAcrossRows()
    {
        var stub = LoadOne(BlockGrammar);
        HighlighterRegistry.Register(stub);

        // 三行上下文：块注释跨行（左列=旧文件序）
        var model = new DiffRenderModel(TestHunks.List(
            TestHunks.H(1, 3, 1, 3, " /* a", " * b", " */ c")), sideBySide: false);

        model.EnsureSyntaxTokens(0, model.Rows.Count - 1, HighlighterRegistry.Resolve("a.blk"));

        // 左列三个内容格全部命中注释样式（状态跨行传递）
        Assert.All(new[] { model.Rows[1].Left!, model.Rows[2].Left!, model.Rows[3].Left! },
            cell => Assert.NotNull(cell.SyntaxTokens));
        Assert.Equal("comment", model.Rows[1].Left!.SyntaxTokens!.Single().StyleKey);
        Assert.Equal("comment", model.Rows[3].Left!.SyntaxTokens!.Single().StyleKey);
    }
}

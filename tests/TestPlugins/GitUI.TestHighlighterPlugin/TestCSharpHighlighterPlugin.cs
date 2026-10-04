using GitUI.Diff.Highlighting;

namespace GitUI.TestHighlighterPlugin;

/// <summary>ALC 插件契约的测试夹具：提供一个小众语言（.testcs）高亮器。</summary>
public sealed class TestCSharpHighlighterPlugin : ISyntaxHighlighterPlugin
{
    public IEnumerable<ISyntaxHighlighter> CreateHighlighters()
    {
        yield return new TestHighlighter();
    }

    internal sealed class TestHighlighter : ISyntaxHighlighter
    {
        public string Id => "plugin.testcs";
        public string Language => "testcs";
        public IReadOnlyList<string> Extensions { get; } = new[] { ".testcs" };
        public bool RequiresSequentialState => false;

        public LineHighlightResult TokenizeLine(string line, LineState? state)
        {
            var spans = new List<SyntaxSpan>();
            var idx = line.IndexOf("PLUGIN", StringComparison.Ordinal);
            if (idx >= 0)
            {
                spans.Add(new SyntaxSpan(idx, 6, "keyword"));
            }

            return new LineHighlightResult(spans, state);
        }
    }
}

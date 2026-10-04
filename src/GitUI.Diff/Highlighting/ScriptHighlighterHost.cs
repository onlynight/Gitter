using Jint;
using Jint.Native;
using Jint.Runtime;

namespace GitUI.Diff.Highlighting;

/// <summary>
/// Jint 脚本宿主（extension-package-framework.md P3 / code-highlight-framework.md P3）：
/// 执行语法包的 init.js，脚本经 <c>gitui.syntax.register(def)</c> 注册高亮器。
///
/// 沙箱：不注入 IO/进程/网络对象；每次 JS 调用 200ms 超时；递归 64 层；内存 4MB 上限；
/// 高亮器运行期故障逐行降级 plain（JintSyntaxHighlighter.TokenizeLine 内捕获）。
/// </summary>
public sealed class ScriptHighlighterHost
{
    /// <summary>单次脚本调用的超时（防死循环）。</summary>
    public const int CallTimeoutMs = 200;

    private readonly Engine _engine;
    private readonly List<ISyntaxHighlighter> _registered = new();

    public ScriptHighlighterHost()
    {
        _engine = new Engine(options => options
            .TimeoutInterval(TimeSpan.FromMilliseconds(CallTimeoutMs))
            .LimitRecursion(64)
            .LimitMemory(4_000_000));

        // gitui.syntax.register(def) → 收集脚本注册的高亮器
        _engine.Execute(
            "var gitui = { syntax: { register: function (def) { __gituiRegister(def); } } };");
        _engine.SetValue("__gituiRegister", new Action<JsValue>(value =>
        {
            var highlighter = JintSyntaxHighlighter.TryCreate(_engine, value);
            if (highlighter is not null)
            {
                _registered.Add(highlighter);
            }
        }));
    }

    /// <summary>已注册的脚本高亮器（Execute 之后可读）。</summary>
    public IReadOnlyList<ISyntaxHighlighter> Registered => _registered.ToArray();

    /// <summary>执行脚本代码（init.js 的内容或测试片段）。</summary>
    /// <exception cref="JintException">语法/运行时错误（调用方据此跳过该包）。</exception>
    /// <exception cref="TimeoutException">超出单次调用超时。</exception>
    public void Execute(string code) => _engine.Execute(code);

    public void ExecuteFile(string path) => Execute(File.ReadAllText(path));

    /// <summary>执行后触发超时/运行时错误的传播版本（测试断言用）。</summary>
    public void ExecuteStrict(string code) => _engine.Execute(code);
}

/// <summary>脚本注册的高亮器：Jint 函数适配 <see cref="ISyntaxHighlighter"/>。</summary>
internal sealed class JintSyntaxHighlighter : ISyntaxHighlighter
{
    private readonly Engine _engine;
    private readonly JsValue _tokenizeFn;
    private readonly string _id;
    private readonly string _language;
    private readonly IReadOnlyList<string> _extensions;

    private JintSyntaxHighlighter(Engine engine, JsValue tokenizeFn, string id, string language, IReadOnlyList<string> extensions)
    {
        _engine = engine;
        _tokenizeFn = tokenizeFn;
        _id = id;
        _language = language;
        _extensions = extensions;
    }

    public string Id => _id;
    public string Language => _language;
    public IReadOnlyList<string> Extensions => _extensions;

    /// <summary>脚本引擎自行管理状态（P4a 顺序约束不适用——脚本按格独立调用，已知限制）。</summary>
    public bool RequiresSequentialState => false;

    public LineHighlightResult TokenizeLine(string line, LineState? state)
    {
        try
        {
            var statePayload = state?.Payload;
            var result = _engine.Invoke(_tokenizeFn, line, statePayload);
            return ParseResult(result, state);
        }
        catch
        {
            // 脚本故障（超时/异常）→ 整行降级 plain（code-highlight-framework.md §四.2）
            return new LineHighlightResult(Array.Empty<SyntaxSpan>(), null);
        }
    }

    private static LineHighlightResult ParseResult(JsValue result, LineState? fallback)
    {
        var spans = new List<SyntaxSpan>();
        if (result.IsObject() && result.Get("spans").IsArray())
        {
            foreach (var entry in result.Get("spans").AsArray())
            {
                if (!entry.IsObject()) continue;

                int start = (int)Math.Clamp(Math.Round(ToNumber(entry.Get("start"))), 0, int.MaxValue);
                int length = (int)Math.Clamp(Math.Round(ToNumber(entry.Get("length"))), 0, int.MaxValue);
                var style = entry.Get("style").ToString();
                if (length > 0 && !string.IsNullOrEmpty(style))
                {
                    spans.Add(new SyntaxSpan(start, length, style));
                }
            }
        }

        LineState? next = fallback;
        if (result.IsObject() && !result.Get("state").IsUndefined())
        {
            next = new LineState { Payload = result.Get("state") };
        }

        return new LineHighlightResult(spans, next);
    }

    private static double ToNumber(JsValue value) =>
        value.IsNumber() ? value.AsNumber() : (double.TryParse(value.ToString(), out var n) ? n : 0);

    /// <summary>从脚本注册对象构建高亮器；def 缺少 id/extensions/tokenizeLine 时返回 null。</summary>
    public static JintSyntaxHighlighter? TryCreate(Engine engine, JsValue def)
    {
        if (!def.IsObject())
        {
            return null;
        }

        var id = def.Get("id").ToString();
        if (string.IsNullOrWhiteSpace(id) || !def.Get("tokenizeLine").IsCallable())
        {
            return null;
        }

        var extensions = new List<string>();
        if (def.Get("extensions").IsArray())
        {
            foreach (var e in def.Get("extensions").AsArray())
            {
                var ext = e.ToString();
                if (!string.IsNullOrWhiteSpace(ext))
                {
                    extensions.Add(ext.StartsWith('.') ? ext : "." + ext);
                }
            }
        }

        if (extensions.Count == 0)
        {
            return null;
        }

        var language = def.Get("language").IsUndefined() ? id : def.Get("language").ToString();
        return new JintSyntaxHighlighter(engine, def.Get("tokenizeLine"), id, language, extensions);
    }
}

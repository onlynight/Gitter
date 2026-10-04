namespace GitUI.Diff.Render;

using GitUI.Diff.Highlighting;

/// <summary>
/// 布局产出的绘制命令。抽象层与具体图形栈解耦：
/// WinUI 控件翻译为 Win2D DrawingSession 调用，Headless 测试用软件光栅化断言像素。
/// </summary>
public abstract record DiffDrawCommand;

/// <summary>矩形填充（行背景 / 行内字级高亮 / 当前变更条）。</summary>
public sealed record FillRectCommand(double X, double Y, double Width, double Height, DiffColorKind Color) : DiffDrawCommand;

/// <summary>一段等宽文本。Y 为行顶（文本的垂直居中由绘制方按字体度量加偏移）；坐标已含水平裁剪。</summary>
public sealed record TextCommand(string Text, double X, double Y, DiffColorKind Color) : DiffDrawCommand;

/// <summary>
/// 一段带显式颜色的等宽文本（语法着色 run，code-highlight-framework.md §五）。
/// 颜色来自活动主题 syntax 段（不走 DiffPalette 语义色），由布局期解析为具体值。
/// </summary>
public sealed record TextRunCommand(string Text, double X, double Y, RgbaColor Color) : DiffDrawCommand;

using System.Text;
using GitUI.Shell;
using GitUI.Shell.Render;
using Xunit;

namespace GitUI.Shell.Tests;

/// <summary>渲染模型：CJK 宽字符必须独立成 run，保证后续字符从网格列起点绘制（不漂移）。</summary>
public sealed class TerminalRenderModelTests
{
    private static (TerminalBuffer Buffer, IReadOnlyList<TermTextRun> Runs) LayoutOf(string input, int cols = 40)
    {
        var buffer = new TerminalBuffer(cols, 10);
        var parser = new TerminalParser(buffer);
        parser.Feed(Encoding.UTF8.GetBytes(input));
        var (_, runs) = TerminalRenderModel.Layout(buffer, TerminalPalette.Dark, firstRow: 0, rows: 10, cols);
        // 只看输入所在的第 0 行（空行也会产出全空白 run）
        return (buffer, runs.Where(r => r.Row == 0).ToList());
    }

    [Fact]
    public void Layout_AsciiOnly_SingleRunStartsAtZero()
    {
        var (_, runs) = LayoutOf("PS D:\\Code> ");
        var r = Assert.Single(runs);
        Assert.Equal(0, r.Col);
        Assert.StartsWith("PS D:\\Code> ", r.Text);
    }

    [Fact]
    public void Layout_CjkInMiddle_SplitsIntoGridAlignedRuns()
    {
        // "ab中文cd"：中/文各占两格（col 2-3、4-5），cd 从 col 6 起（行尾空白并入 cd 所在 run）
        var (_, runs) = LayoutOf("ab中文cd");

        Assert.Collection(runs,
            r => { Assert.Equal(0, r.Col); Assert.Equal("ab", r.Text); },
            r => { Assert.Equal(2, r.Col); Assert.Equal("中", r.Text); },
            r => { Assert.Equal(4, r.Col); Assert.Equal("文", r.Text); },
            r => { Assert.Equal(6, r.Col); Assert.StartsWith("cd", r.Text); });
    }

    [Fact]
    public void Layout_CjkPrompt_InputAfterItStartsAtTrueColumn()
    {
        // 提示符含中文的场景：">" 与其后输入 cmd 同属一个 ASCII run，
        // 该 run 必须从 ">" 的真实格位起绘（其后字符随等宽步进自然对齐）
        var (_, runs) = LayoutOf("D:\\\u5DE5\u4F5C>cmd"); // D:\工作>cmd
        var last = runs[^1];
        Assert.StartsWith(">cmd", last.Text);
        // D:\=3 格 + 工作=4 格 → > 在 col 7
        Assert.Equal(7, last.Col);
    }
}

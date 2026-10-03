using Xunit;
using GitUI.Diff.Render;

namespace GitUI.Render.Tests;

public class PaletteTests
{
    [Fact]
    public void AllKindsMapped_BothThemes()
    {
        foreach (var palette in new[] { DiffPalette.Light, DiffPalette.Dark })
        {
            foreach (var kind in Enum.GetValues<DiffColorKind>())
            {
                var c = palette[kind];
                Assert.Equal(0xFF, c.A);
                Assert.True(c.R + c.G + c.B > 0, $"{kind} 是纯黑，疑似漏配");
            }
        }
    }

    [Fact]
    public void ThemesDiffer()
    {
        Assert.NotEqual(DiffPalette.Light[DiffColorKind.Background], DiffPalette.Dark[DiffColorKind.Background]);
        Assert.NotEqual(DiffPalette.Light[DiffColorKind.AddedBackground], DiffPalette.Dark[DiffColorKind.AddedBackground]);
    }

    [Fact]
    public void WordHighlightStrongerThanRowBackground()
    {
        // 字级高亮必须与行背景可区分（两个主题都是）
        foreach (var palette in new[] { DiffPalette.Light, DiffPalette.Dark })
        {
            Assert.NotEqual(palette[DiffColorKind.AddedBackground], palette[DiffColorKind.AddedWordBackground]);
            Assert.NotEqual(palette[DiffColorKind.DeletedBackground], palette[DiffColorKind.DeletedWordBackground]);
        }
    }
}

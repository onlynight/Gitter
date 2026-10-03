namespace GitUI.Diff.Render;

/// <summary>渲染行的语义类型（S3 DiffCanvas 渲染管线，design.md §4.4 / §8-S3）。</summary>
public enum DiffRowKind
{
    /// <summary>上下文行（两侧相同）。</summary>
    Context,

    /// <summary>新增行（+）。</summary>
    Added,

    /// <summary>删除行（-）。</summary>
    Deleted,

    /// <summary>填充行（并排视图中另一侧无内容时的空白占位）。</summary>
    Filler,

    /// <summary>hunk 头分隔行（@@ -a,b +c,d @@），全宽显示、不随水平滚动。</summary>
    HunkHeader,

    /// <summary>"\ No newline at end of file" 标记行（git 同款文案）。</summary>
    NoNewlineMarker,
}

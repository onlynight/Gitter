namespace GitUI.Core.Models;

/// <summary>单个文件的行数统计（numstat）。二进制文件两侧均为 null。</summary>
public readonly record struct DiffNumStat(int? AddedLines, int? DeletedLines);

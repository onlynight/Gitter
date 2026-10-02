namespace GitUI.Core.Models;

/// <summary>
/// 树对象中的一个条目。不可变。
/// </summary>
/// <param name="Path">相对仓库根的完整路径（含父目录）。</param>
/// <param name="Name">仅当前层级文件名。</param>
/// <param name="Sha">条目对象 SHA。</param>
/// <param name="Mode">文件模式（Unix 权限位）。</param>
/// <param name="EntryType">条目类型。</param>
public sealed record TreeEntry(
    string Path,
    string Name,
    string Sha,
    FileMode Mode,
    TreeEntryType EntryType);

public enum TreeEntryType
{
    Blob,
    Tree,
    GitLink,
    Submodule,
}

/// <summary>Git 文件模式，值与 git 一致以便直接比较。C# 无八进制字面量，故写为十进制等价值。</summary>
public enum FileMode
{
    NonExecutable = 33188, // 0100644
    Executable = 33261,    // 0100755
    Tree = 16384,          // 0040000
    Symlink = 49152,       // 0120000
    GitLink = 65536,       // 0160000
}

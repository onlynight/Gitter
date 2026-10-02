namespace GitUI.Git;

/// <summary>
/// S0 阶段占位类型。S1 阶段会在此项目中实现 IRepositoryService、GitWorker 与 libgit2sharp 集成。
/// 保留占位是为了让 GitUI.App 现在就能引用 GitUI.Git，避免 S1 阶段重复改动引用关系。
/// </summary>
internal static class Placeholder
{
}

namespace GitUI.Core.Services;

/// <summary>
/// <see cref="IRepositoryService"/> 工厂。便于 DI 注入与测试替身替换。
/// </summary>
public interface IRepositoryFactory
{
    IRepositoryService Create();
}

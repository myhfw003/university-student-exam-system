namespace Exam.Application.Common.Interfaces;

/// <summary>
/// 只读仓储基类。
/// <para>
/// 刻意不暴露 <see cref="IQueryable{T}"/>：应用层不得依赖 EF Core，
/// 异步物化只能在基础设施层完成，因此每个查询都由仓储显式声明。
/// </para>
/// </summary>
public interface IReadRepository<T>
    where T : class
{
}

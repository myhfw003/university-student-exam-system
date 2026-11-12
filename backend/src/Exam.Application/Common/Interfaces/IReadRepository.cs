namespace Exam.Application.Common.Interfaces;

/// <summary>
/// 只读仓储。返回 <see cref="IQueryable{T}"/>（BCL 类型）以便在应用层做投影，
/// 同时避免应用层依赖 EF Core。
/// </summary>
public interface IReadRepository<T>
    where T : class
{
    IQueryable<T> Query();
}

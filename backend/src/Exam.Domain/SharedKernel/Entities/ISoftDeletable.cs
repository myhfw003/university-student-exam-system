namespace Exam.Domain.SharedKernel.Entities;

/// <summary>
/// 可软删除实体标记。实现该接口的实体由 EF Core 全局查询过滤器自动排除已删除行。
/// 追加式（append-only）实体不实现本接口——它们没有 deleted_at，也没有状态可改。
/// </summary>
public interface ISoftDeletable
{
    DateTimeOffset? DeletedAt { get; }
}

namespace Exam.Domain.SharedKernel.Entities;

/// <summary>
/// 带审计字段与全局软删除的业务实体基类。
/// 追加式（append-only）实体不继承本类——它们没有 deleted_at，也没有状态可改。
/// </summary>
public abstract class AuditableEntity : AggregateRoot<long>, ISoftDeletable
{
    protected AuditableEntity() { }

    protected AuditableEntity(DateTimeOffset now, long? actorId)
    {
        CreatedAt = now;
        CreatedBy = actorId;
    }

    public DateTimeOffset CreatedAt { get; protected set; }

    public long? CreatedBy { get; protected set; }

    public DateTimeOffset? UpdatedAt { get; protected set; }

    public long? UpdatedBy { get; protected set; }

    public DateTimeOffset? DeletedAt { get; protected set; }

    /// <summary>
    /// 乐观并发令牌。映射到 PostgreSQL 的 xmin 系统列，无额外物理列开销。
    /// </summary>
    public uint Version { get; private set; }

    public bool IsDeleted => DeletedAt.HasValue;

    public void Touch(DateTimeOffset now, long? actorId)
    {
        UpdatedAt = now;
        UpdatedBy = actorId;
    }

    /// <summary>全局软删除。重复调用幂等。</summary>
    public void SoftDelete(DateTimeOffset now, long? actorId)
    {
        if (IsDeleted)
        {
            return;
        }

        DeletedAt = now;
        Touch(now, actorId);
    }
}

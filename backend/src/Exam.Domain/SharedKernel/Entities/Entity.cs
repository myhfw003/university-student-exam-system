namespace Exam.Domain.SharedKernel.Entities;

/// <summary>实体基类。标识为强类型结构体，防止把不同实体的 Id 混用。</summary>
public abstract class Entity<TId>
    where TId : struct, IEquatable<TId>
{
    protected Entity() => Id = default;

    protected Entity(TId id) => Id = id;

    public TId Id { get; protected set; }
}

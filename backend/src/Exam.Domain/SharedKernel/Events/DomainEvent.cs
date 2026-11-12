namespace Exam.Domain.SharedKernel.Events;

/// <summary>领域事件基类。</summary>
public abstract record DomainEvent : IDomainEvent
{
    public DateTimeOffset OccurredAt { get; init; } = DateTimeOffset.UtcNow;
}

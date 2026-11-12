namespace Exam.Domain.SharedKernel.Events;

/// <summary>领域事件标记接口。事件在聚合内部产生，跨上下文通过 Outbox 传播。</summary>
public interface IDomainEvent
{
    DateTimeOffset OccurredAt { get; }
}

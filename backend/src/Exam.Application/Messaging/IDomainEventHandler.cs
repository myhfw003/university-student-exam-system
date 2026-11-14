using Exam.Domain.SharedKernel.Events;

namespace Exam.Application.Messaging;

/// <summary>
/// 领域事件处理器。
/// <para>
/// 事件从 Outbox 取出后，派发给对应类型的处理器。
/// </para>
/// </summary>
public interface IDomainEventHandler<in TEvent>
    where TEvent : IDomainEvent
{
    Task HandleAsync(TEvent domainEvent, CancellationToken cancellationToken = default);
}

namespace Exam.Application.Messaging;

/// <summary>领域事件派发。</summary>
public interface IDomainEventDispatcher
{
    /// <summary>派发一条消息。</summary>
    Task DispatchAsync(OutboxEnvelope message, CancellationToken cancellationToken = default);

    /// <summary>派发所有待派发的消息，返回派发成功的条数。</summary>
    Task<int> DispatchPendingAsync(int batchSize = 100, CancellationToken cancellationToken = default);
}

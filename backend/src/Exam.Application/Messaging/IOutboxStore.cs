namespace Exam.Application.Messaging;

/// <summary>Outbox 里的一条待派发消息。</summary>
public sealed record OutboxEnvelope(
    long Id,
    string MessageType,
    string Payload,
    DateTimeOffset OccurredAt,
    int Attempts);

/// <summary>
/// Outbox 存取。
/// <para>
/// 领域事件与聚合状态落在同一个事务里；派发是另一件事，Worker 轮询着办。
/// </para>
/// </summary>
public interface IOutboxStore
{
    /// <summary>取回待派发的消息，按发生顺序。</summary>
    Task<IReadOnlyList<OutboxEnvelope>> ListPendingAsync(
        int batchSize,
        CancellationToken cancellationToken = default);

    /// <summary>标记为已派发。</summary>
    Task MarkDispatchedAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>标记为派发失败，记下原因。</summary>
    Task MarkFailedAsync(long id, string error, CancellationToken cancellationToken = default);
}

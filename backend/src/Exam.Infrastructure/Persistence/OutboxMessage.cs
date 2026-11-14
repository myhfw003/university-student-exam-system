using Exam.Domain.SharedKernel.Entities;

namespace Exam.Infrastructure.Persistence;

/// <summary>
/// Outbox 消息。
/// <para>
/// 领域事件与聚合状态落在同一个事务里；派发是另一件事，由 Worker 轮询着办。
/// 这样不会出现「状态改了，事件没送到」的半截状态。
/// </para>
/// </summary>
public sealed class OutboxMessage : Entity<long>
{
    private OutboxMessage()
    {
    }

    private OutboxMessage(string messageType, string payload, DateTimeOffset occurredAt)
    {
        MessageType = messageType;
        Payload = payload;
        OccurredAt = occurredAt;
    }

    /// <summary>事件类型（完整类型名）。</summary>
    public string MessageType { get; private set; } = string.Empty;

    /// <summary>事件负载（JSON）。</summary>
    public string Payload { get; private set; } = "{}";

    /// <summary>发生时间。</summary>
    public DateTimeOffset OccurredAt { get; private set; }

    /// <summary>派发时间。没派发过就是空。</summary>
    public DateTimeOffset? DispatchedAt { get; private set; }

    /// <summary>派发尝试次数。</summary>
    public int Attempts { get; private set; }

    /// <summary>最近一次失败的原因。</summary>
    public string? LastError { get; private set; }

    public static OutboxMessage Create(string messageType, string payload, DateTimeOffset occurredAt) =>
        new(messageType, payload, occurredAt);

    public void MarkDispatched(DateTimeOffset now)
    {
        DispatchedAt = now;
        Attempts++;
        LastError = null;
    }

    public void MarkFailed(string error)
    {
        Attempts++;
        LastError = error.Length > 1000 ? error[..1000] : error;
    }
}

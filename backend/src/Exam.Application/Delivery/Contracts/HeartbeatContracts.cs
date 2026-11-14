namespace Exam.Application.Delivery.Contracts;

/// <summary>心跳响应。</summary>
public sealed record HeartbeatResponse(
    DateTimeOffset ServerTime,
    long RemainingSeconds,
    int DisconnectCount,
    int WarningCount,
    string Status,
    bool Submitted,
    string SubmitReason);

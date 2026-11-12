using Exam.Domain.SharedKernel.Entities;

namespace Exam.Domain.Audit;

/// <summary>
/// 审计日志。追加式：数据库层已回收应用账号的 UPDATE / DELETE 权限。
/// </summary>
public sealed class AuditLog : Entity<long>
{
    public AuditLog()
    {
    }

    private AuditLog(
        long? operatorId,
        string? operatorName,
        string action,
        string? targetType,
        string? targetId,
        DateTimeOffset occurredAt)
    {
        OperatorId = operatorId;
        OperatorName = operatorName;
        Action = action;
        TargetType = targetType;
        TargetId = targetId;
        OccurredAt = occurredAt;
    }

    public long? OperatorId { get; private set; }

    public string? OperatorName { get; private set; }

    public string Action { get; private set; } = string.Empty;

    public string? TargetType { get; private set; }

    public string? TargetId { get; private set; }

    public string Summary { get; private set; } = "{}";

    public string? IpAddress { get; private set; }

    public string? UserAgent { get; private set; }

    public string? RequestId { get; private set; }

    public DateTimeOffset OccurredAt { get; private set; }

    public static AuditLog Create(
        long? operatorId,
        string? operatorName,
        string action,
        string? targetType,
        string? targetId,
        DateTimeOffset occurredAt) =>
        new(operatorId, operatorName, action, targetType, targetId, occurredAt);

    public void WithContext(string? ipAddress, string? userAgent, string? requestId)
    {
        IpAddress = ipAddress;
        UserAgent = userAgent;
        RequestId = requestId;
    }

    public void WithSummary(string json) => Summary = json;
}

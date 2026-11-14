namespace Exam.Application.Audit.Contracts;

/// <summary>审计日志条目。</summary>
public sealed record AuditLogDto(
    long Id,
    long? OperatorId,
    string? OperatorName,
    string Action,
    string? TargetType,
    string? TargetId,
    string Summary,
    string? IpAddress,
    string? UserAgent,
    DateTimeOffset OccurredAt);

/// <summary>分页的审计日志。</summary>
public sealed record AuditLogListResponse(
    IReadOnlyList<AuditLogDto> Items,
    int Total,
    int Page,
    int Size);

using Exam.Application.Audit.Contracts;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Identity;
using MediatR;

namespace Exam.Application.Audit.Queries;

/// <summary>分页查询审计日志。</summary>
public sealed record ListAuditLogsQuery(
    string? Action,
    string? TargetType,
    string? TargetId,
    long? OperatorId,
    DateTimeOffset? From,
    DateTimeOffset? To,
    int Page,
    int Size) : IAppQuery<AuditLogListResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AuditRead];
}

public sealed class ListAuditLogsHandler : IRequestHandler<ListAuditLogsQuery, AuditLogListResponse>
{
    private readonly IAuditLogRepository _auditLogs;

    public ListAuditLogsHandler(IAuditLogRepository auditLogs) => _auditLogs = auditLogs;

    public async Task<AuditLogListResponse> Handle(
        ListAuditLogsQuery request,
        CancellationToken cancellationToken)
    {
        var page = Math.Max(1, request.Page);
        var size = Math.Clamp(request.Size, 1, 200);

        var total = await _auditLogs.CountAsync(
            request.Action,
            request.TargetType,
            request.TargetId,
            request.OperatorId,
            request.From,
            request.To,
            cancellationToken);

        var logs = await _auditLogs.SearchAsync(
            request.Action,
            request.TargetType,
            request.TargetId,
            request.OperatorId,
            request.From,
            request.To,
            (page - 1) * size,
            size,
            cancellationToken);

        var items = logs
            .Select(log => new AuditLogDto(
                log.Id,
                log.OperatorId,
                log.OperatorName,
                log.Action,
                log.TargetType,
                log.TargetId,
                log.Summary,
                log.IpAddress,
                log.UserAgent,
                log.OccurredAt))
            .ToList();

        return new AuditLogListResponse(items, total, page, size);
    }
}

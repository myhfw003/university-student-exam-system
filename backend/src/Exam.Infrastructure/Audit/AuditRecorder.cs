using System.Text.Json;
using Exam.Application.Common.Interfaces;
using Exam.Domain.Audit;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Audit;

/// <summary>
/// 显式审计记录器。实体字段变更的自动留痕由 EF 拦截器承担（P1 阶段接入）。
/// </summary>
public sealed class AuditRecorder : IAuditRecorder
{
    private static readonly JsonSerializerOptions SummaryOptions = new() { WriteIndented = false };

    private readonly AppDbContext _db;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;
    private readonly IRequestContext _requestContext;

    public AuditRecorder(
        AppDbContext db,
        IClock clock,
        ICurrentUser currentUser,
        IRequestContext requestContext)
    {
        _db = db;
        _clock = clock;
        _currentUser = currentUser;
        _requestContext = requestContext;
    }

    public async Task RecordAsync(
        string action,
        string? targetType = null,
        string? targetId = null,
        IReadOnlyDictionary<string, object?>? summary = null,
        CancellationToken cancellationToken = default)
    {
        var log = AuditLog.Create(
            _currentUser.UserId,
            _currentUser.Username,
            action,
            targetType,
            targetId,
            _clock.UtcNow);

        log.WithContext(_requestContext.IpAddress, _requestContext.UserAgent, _currentUser.UserId?.ToString());

        if (summary is { Count: > 0 })
        {
            log.WithSummary(JsonSerializer.Serialize(summary, SummaryOptions));
        }

        await _db.Set<AuditLog>().AddAsync(log, cancellationToken);
    }
}

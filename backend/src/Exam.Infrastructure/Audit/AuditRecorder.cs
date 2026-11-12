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

    public AuditRecorder(AppDbContext db, IClock clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task RecordAsync(
        string action,
        string? targetType = null,
        string? targetId = null,
        IReadOnlyDictionary<string, object?>? summary = null,
        CancellationToken cancellationToken = default)
    {
        var log = AuditLog.Create(null, null, action, targetType, targetId, _clock.UtcNow);

        if (summary is { Count: > 0 })
        {
            log.WithSummary(JsonSerializer.Serialize(summary, SummaryOptions));
        }

        await _db.Set<AuditLog>().AddAsync(log, cancellationToken);
    }
}

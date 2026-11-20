using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Unicode;
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
    // 中文按原样写：默认编码器会把中文转成 \uXXXX，审计页上就没法看了。
    private static readonly JsonSerializerOptions SummaryOptions = new()
    {
        WriteIndented = false,
        Encoder = JavaScriptEncoder.Create(UnicodeRanges.All),
    };

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

    public Task RecordAsync(
        string action,
        string? targetType = null,
        string? targetId = null,
        IReadOnlyDictionary<string, object?>? summary = null,
        CancellationToken cancellationToken = default) =>
        RecordAsAsync(
            _currentUser.UserId,
            _currentUser.Username,
            action,
            targetType,
            targetId,
            summary,
            cancellationToken);

    public async Task RecordAsAsync(
        long? operatorId,
        string? operatorName,
        string action,
        string? targetType = null,
        string? targetId = null,
        IReadOnlyDictionary<string, object?>? summary = null,
        CancellationToken cancellationToken = default)
    {
        var log = AuditLog.Create(
            operatorId,
            operatorName,
            action,
            targetType,
            targetId,
            _clock.UtcNow);

        log.WithContext(_requestContext.IpAddress, _requestContext.UserAgent, operatorId?.ToString());

        if (summary is { Count: > 0 })
        {
            log.WithSummary(JsonSerializer.Serialize(summary, SummaryOptions));
        }

        await _db.Set<AuditLog>().AddAsync(log, cancellationToken);
    }
}

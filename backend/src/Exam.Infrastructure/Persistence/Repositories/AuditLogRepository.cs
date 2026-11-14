using Exam.Application.Common.Interfaces;
using Exam.Domain.Audit;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class AuditLogRepository : IAuditLogRepository
{
    private readonly AppDbContext _db;

    public AuditLogRepository(AppDbContext db) => _db = db;

    public async Task<IReadOnlyList<AuditLog>> SearchAsync(
        string? action,
        string? targetType,
        string? targetId,
        long? operatorId,
        DateTimeOffset? from,
        DateTimeOffset? to,
        int skip,
        int take,
        CancellationToken cancellationToken = default) =>
        await Filtered(action, targetType, targetId, operatorId, from, to)
            .OrderByDescending(x => x.OccurredAt)
            .ThenByDescending(x => x.Id)
            .Skip(skip)
            .Take(take)
            .ToListAsync(cancellationToken);

    public Task<int> CountAsync(
        string? action,
        string? targetType,
        string? targetId,
        long? operatorId,
        DateTimeOffset? from,
        DateTimeOffset? to,
        CancellationToken cancellationToken = default) =>
        Filtered(action, targetType, targetId, operatorId, from, to).CountAsync(cancellationToken);

    private IQueryable<AuditLog> Filtered(
        string? action,
        string? targetType,
        string? targetId,
        long? operatorId,
        DateTimeOffset? from,
        DateTimeOffset? to)
    {
        var query = _db.Set<AuditLog>().AsNoTracking();

        if (!string.IsNullOrWhiteSpace(action))
        {
            var value = action.Trim();
            query = query.Where(x => x.Action == value);
        }

        if (!string.IsNullOrWhiteSpace(targetType))
        {
            var value = targetType.Trim();
            query = query.Where(x => x.TargetType == value);
        }

        if (!string.IsNullOrWhiteSpace(targetId))
        {
            var value = targetId.Trim();
            query = query.Where(x => x.TargetId == value);
        }

        if (operatorId is not null)
        {
            query = query.Where(x => x.OperatorId == operatorId.Value);
        }

        if (from is not null)
        {
            query = query.Where(x => x.OccurredAt >= from.Value);
        }

        if (to is not null)
        {
            query = query.Where(x => x.OccurredAt <= to.Value);
        }

        return query;
    }
}

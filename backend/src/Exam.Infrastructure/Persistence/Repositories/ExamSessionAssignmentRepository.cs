using Exam.Application.Common.Interfaces;
using Exam.Domain.Delivery;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class ExamSessionAssignmentRepository : IExamSessionAssignmentRepository
{
    private readonly AppDbContext _db;

    public ExamSessionAssignmentRepository(AppDbContext db) => _db = db;

    public async Task<IReadOnlyList<ExamSessionAssignment>> ListBySessionAsync(
        long examSessionId,
        CancellationToken cancellationToken = default) =>
        await _db.Set<ExamSessionAssignment>()
            .AsNoTracking()
            .Where(a => a.ExamSessionId == examSessionId)
            .OrderBy(a => a.UserId)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<long>> ListSessionIdsByUserAsync(
        long userId,
        CancellationToken cancellationToken = default) =>
        await _db.Set<ExamSessionAssignment>()
            .AsNoTracking()
            .Where(a => a.UserId == userId)
            .Select(a => a.ExamSessionId)
            .Distinct()
            .ToListAsync(cancellationToken);

    public async Task AddRangeAsync(
        IReadOnlyCollection<ExamSessionAssignment> assignments,
        CancellationToken cancellationToken = default)
    {
        if (assignments.Count == 0)
        {
            return;
        }

        await _db.Set<ExamSessionAssignment>().AddRangeAsync(assignments, cancellationToken);
    }

    public async Task DeleteExceptAsync(
        long examSessionId,
        IReadOnlyCollection<long> keepUserIds,
        CancellationToken cancellationToken = default)
    {
        var keep = keepUserIds.ToHashSet();

        var existing = await _db.Set<ExamSessionAssignment>()
            .Where(a => a.ExamSessionId == examSessionId && !keep.Contains(a.UserId))
            .ToListAsync(cancellationToken);

        if (existing.Count == 0)
        {
            return;
        }

        _db.Set<ExamSessionAssignment>().RemoveRange(existing);
    }

    public async Task DeleteBySessionAsync(long examSessionId, CancellationToken cancellationToken = default)
    {
        var existing = await _db.Set<ExamSessionAssignment>()
            .Where(a => a.ExamSessionId == examSessionId)
            .ToListAsync(cancellationToken);

        if (existing.Count == 0)
        {
            return;
        }

        _db.Set<ExamSessionAssignment>().RemoveRange(existing);
    }
}

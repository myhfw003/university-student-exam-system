using Exam.Application.Common.Interfaces;
using Exam.Domain.Delivery;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class AttemptRepository : IAttemptRepository
{
    private readonly AppDbContext _db;

    public AttemptRepository(AppDbContext db) => _db = db;

    public Task<Attempt?> GetByIdAsync(long id, CancellationToken cancellationToken = default) =>
        _db.Set<Attempt>().FirstOrDefaultAsync(a => a.Id == id, cancellationToken);

    public Task<Attempt?> GetActiveAsync(
        long userId,
        long examSessionId,
        CancellationToken cancellationToken = default) =>
        _db.Set<Attempt>()
            .Where(a => a.UserId == userId
                && a.ExamSessionId == examSessionId
                && (a.Status == AttemptStatus.InProgress || a.Status == AttemptStatus.NotStarted))
            .OrderByDescending(a => a.AttemptNo)
            .FirstOrDefaultAsync(cancellationToken);

    public Task<Attempt?> GetActivePracticeAsync(
        long userId,
        long practiceAssignmentId,
        CancellationToken cancellationToken = default) =>
        _db.Set<Attempt>()
            .Where(a => a.UserId == userId
                && a.PracticeAssignmentId == practiceAssignmentId
                && (a.Status == AttemptStatus.InProgress || a.Status == AttemptStatus.NotStarted))
            .OrderByDescending(a => a.AttemptNo)
            .FirstOrDefaultAsync(cancellationToken);

    public async Task<IReadOnlyDictionary<long, int>> CountByPracticeAssignmentsAsync(
        IReadOnlyCollection<long> practiceAssignmentIds,
        CancellationToken cancellationToken = default)
    {
        if (practiceAssignmentIds.Count == 0)
        {
            return new Dictionary<long, int>();
        }

        var rows = await _db.Set<Attempt>()
            .AsNoTracking()
            .Where(a => a.PracticeAssignmentId != null && practiceAssignmentIds.Contains(a.PracticeAssignmentId!.Value))
            .GroupBy(a => a.PracticeAssignmentId!.Value)
            .Select(g => new { AssignmentId = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);

        return rows.ToDictionary(r => r.AssignmentId, r => r.Count);
    }

    public Task<int> CountByPracticeAsync(
        long userId,
        long practiceAssignmentId,
        CancellationToken cancellationToken = default) =>
        _db.Set<Attempt>()
            .CountAsync(a => a.UserId == userId && a.PracticeAssignmentId == practiceAssignmentId, cancellationToken);

    public async Task<IReadOnlyList<Attempt>> GetByIdsAsync(
        IReadOnlyCollection<long> ids,
        CancellationToken cancellationToken = default)
    {
        if (ids.Count == 0)
        {
            return [];
        }

        var idList = ids.ToList();
        return await _db.Set<Attempt>()
            .AsNoTracking()
            .Where(a => idList.Contains(a.Id))
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Attempt>> ListBySessionAsync(
        long examSessionId,
        CancellationToken cancellationToken = default) =>
        await _db.Set<Attempt>()
            .AsNoTracking()
            .Where(a => a.ExamSessionId == examSessionId)
            .OrderBy(a => a.UserId)
            .ThenBy(a => a.AttemptNo)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<Attempt>> ListByUserAsync(
        long userId,
        CancellationToken cancellationToken = default) =>
        await _db.Set<Attempt>()
            .AsNoTracking()
            .Where(a => a.UserId == userId)
            .OrderByDescending(a => a.CreatedAt)
            .ThenByDescending(a => a.Id)
            .ToListAsync(cancellationToken);

    public Task<int> CountByUserAsync(
        long userId,
        long examSessionId,
        CancellationToken cancellationToken = default) =>
        _db.Set<Attempt>()
            .CountAsync(a => a.UserId == userId && a.ExamSessionId == examSessionId, cancellationToken);

    public async Task AddAsync(Attempt attempt, CancellationToken cancellationToken = default) =>
        await _db.Set<Attempt>().AddAsync(attempt, cancellationToken);

    public void Update(Attempt attempt) => _db.Set<Attempt>().Update(attempt);
}

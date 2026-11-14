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

using Exam.Application.Common.Interfaces;
using Exam.Domain.Grading;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class ScoreResultRepository : IScoreResultRepository
{
    private readonly AppDbContext _db;

    public ScoreResultRepository(AppDbContext db) => _db = db;

    public async Task<IReadOnlyList<ScoreResult>> ListByAttemptAsync(
        long attemptId,
        CancellationToken cancellationToken = default) =>
        await _db.Set<ScoreResult>()
            .AsNoTracking()
            .Where(r => r.AttemptId == attemptId)
            .OrderBy(r => r.QuestionId)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<ScoreResult>> ListByAttemptsAsync(
        IReadOnlyCollection<long> attemptIds,
        CancellationToken cancellationToken = default)
    {
        if (attemptIds.Count == 0)
        {
            return [];
        }

        return await _db.Set<ScoreResult>()
            .AsNoTracking()
            .Where(r => attemptIds.Contains(r.AttemptId))
            .OrderBy(r => r.AttemptId)
            .ThenBy(r => r.QuestionId)
            .ToListAsync(cancellationToken);
    }

    public Task<ScoreResult?> GetAsync(long attemptId, long questionId, CancellationToken cancellationToken = default) =>
        _db.Set<ScoreResult>()
            .FirstOrDefaultAsync(r => r.AttemptId == attemptId && r.QuestionId == questionId, cancellationToken);

    public async Task AddRangeAsync(
        IReadOnlyCollection<ScoreResult> results,
        CancellationToken cancellationToken = default)
    {
        if (results.Count == 0)
        {
            return;
        }

        await _db.Set<ScoreResult>().AddRangeAsync(results, cancellationToken);
    }

    public void Update(ScoreResult result) => _db.Set<ScoreResult>().Update(result);
}

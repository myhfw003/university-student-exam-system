using Exam.Application.Common.Interfaces;
using Exam.Domain.Grading;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

/// <summary>改分流水。追加式仓储：只有写入与查询，没有修改、没有删除。</summary>
public sealed class GradeRevisionRepository : IGradeRevisionRepository
{
    private readonly AppDbContext _db;

    public GradeRevisionRepository(AppDbContext db) => _db = db;

    public async Task AddAsync(GradeRevision revision, CancellationToken cancellationToken = default) =>
        await _db.Set<GradeRevision>().AddAsync(revision, cancellationToken);

    public Task<int> CountByScoreResultAsync(
        long scoreResultId,
        CancellationToken cancellationToken = default) =>
        _db.Set<GradeRevision>()
            .AsNoTracking()
            .CountAsync(r => r.ScoreResultId == scoreResultId, cancellationToken);

    public async Task<IReadOnlyList<GradeRevision>> ListByAttemptAsync(
        long attemptId,
        CancellationToken cancellationToken = default) =>
        await _db.Set<GradeRevision>()
            .AsNoTracking()
            .Where(r => _db.Set<ScoreResult>()
                .Any(sr => sr.Id == r.ScoreResultId && sr.AttemptId == attemptId))
            .OrderBy(r => r.OccurredAt)
            .ThenBy(r => r.Id)
            .ToListAsync(cancellationToken);
}

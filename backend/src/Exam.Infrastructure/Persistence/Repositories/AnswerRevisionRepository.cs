using Exam.Application.Common.Interfaces;
using Exam.Domain.Delivery;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class AnswerRevisionRepository : IAnswerRevisionRepository
{
    private readonly AppDbContext _db;

    public AnswerRevisionRepository(AppDbContext db) => _db = db;

    public async Task<IReadOnlyList<AnswerRevision>> ListByAttemptAsync(
        long attemptId,
        CancellationToken cancellationToken = default) =>
        await _db.Set<AnswerRevision>()
            .AsNoTracking()
            .Where(r => r.AttemptId == attemptId)
            .OrderBy(r => r.ServerReceivedAt)
            .ThenBy(r => r.Id)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<AnswerRevision>> ListByQuestionAsync(
        long attemptId,
        long questionId,
        CancellationToken cancellationToken = default) =>
        await _db.Set<AnswerRevision>()
            .AsNoTracking()
            .Where(r => r.AttemptId == attemptId && r.QuestionId == questionId)
            .OrderByDescending(r => r.ServerReceivedAt)
            .ThenByDescending(r => r.Id)
            .ToListAsync(cancellationToken);

    public async Task AddRangeAsync(
        IReadOnlyCollection<AnswerRevision> revisions,
        CancellationToken cancellationToken = default)
    {
        if (revisions.Count == 0)
        {
            return;
        }

        await _db.Set<AnswerRevision>().AddRangeAsync(revisions, cancellationToken);
    }
}

using Exam.Application.Common.Interfaces;
using Exam.Domain.Delivery;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class AnswerRepository : IAnswerRepository
{
    private readonly AppDbContext _db;

    public AnswerRepository(AppDbContext db) => _db = db;

    public async Task<IReadOnlyList<Answer>> ListByAttemptAsync(
        long attemptId,
        CancellationToken cancellationToken = default) =>
        await _db.Set<Answer>()
            .AsNoTracking()
            .Where(a => a.AttemptId == attemptId)
            .OrderBy(a => a.QuestionId)
            .ToListAsync(cancellationToken);

    public Task<Answer?> GetAsync(long attemptId, long questionId, CancellationToken cancellationToken = default) =>
        _db.Set<Answer>()
            .FirstOrDefaultAsync(a => a.AttemptId == attemptId && a.QuestionId == questionId, cancellationToken);

    public async Task AddRangeAsync(
        IReadOnlyCollection<Answer> answers,
        CancellationToken cancellationToken = default)
    {
        if (answers.Count == 0)
        {
            return;
        }

        await _db.Set<Answer>().AddRangeAsync(answers, cancellationToken);
    }

    public void Update(Answer answer) => _db.Set<Answer>().Update(answer);
}

using Exam.Application.Common.Interfaces;
using Exam.Domain.Learning;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class MistakeRepository : IMistakeRepository
{
    private readonly AppDbContext _db;

    public MistakeRepository(AppDbContext db) => _db = db;

    public Task<Mistake?> GetAsync(
        long userId,
        long questionId,
        CancellationToken cancellationToken = default) =>
        _db.Set<Mistake>()
            .FirstOrDefaultAsync(
                m => m.UserId == userId && m.QuestionId == questionId,
                cancellationToken);

    public async Task AddAsync(Mistake mistake, CancellationToken cancellationToken = default) =>
        await _db.Set<Mistake>().AddAsync(mistake, cancellationToken);

    public void Update(Mistake mistake) => _db.Set<Mistake>().Update(mistake);
}

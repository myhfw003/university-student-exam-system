using Exam.Application.Common.Interfaces;
using Exam.Domain.Delivery;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class ExamParticipantRepository : IExamParticipantRepository
{
    private readonly AppDbContext _db;

    public ExamParticipantRepository(AppDbContext db) => _db = db;

    public async Task<IReadOnlyList<ExamParticipant>> ListBySessionAsync(
        long examSessionId,
        CancellationToken cancellationToken = default) =>
        await _db.Set<ExamParticipant>()
            .AsNoTracking()
            .Where(p => p.ExamSessionId == examSessionId)
            .OrderBy(p => p.UserId)
            .ToListAsync(cancellationToken);

    public Task<ExamParticipant?> GetAsync(
        long examSessionId,
        long userId,
        CancellationToken cancellationToken = default) =>
        _db.Set<ExamParticipant>()
            .FirstOrDefaultAsync(p => p.ExamSessionId == examSessionId && p.UserId == userId, cancellationToken);

    public Task<int> CountBySessionAsync(long examSessionId, CancellationToken cancellationToken = default) =>
        _db.Set<ExamParticipant>().CountAsync(p => p.ExamSessionId == examSessionId, cancellationToken);

    public async Task AddRangeAsync(
        IReadOnlyCollection<ExamParticipant> participants,
        CancellationToken cancellationToken = default)
    {
        if (participants.Count == 0)
        {
            return;
        }

        await _db.Set<ExamParticipant>().AddRangeAsync(participants, cancellationToken);
    }

    public async Task DeleteBySessionAsync(long examSessionId, CancellationToken cancellationToken = default)
    {
        var existing = await _db.Set<ExamParticipant>()
            .Where(p => p.ExamSessionId == examSessionId)
            .ToListAsync(cancellationToken);

        if (existing.Count == 0)
        {
            return;
        }

        _db.Set<ExamParticipant>().RemoveRange(existing);
    }
}

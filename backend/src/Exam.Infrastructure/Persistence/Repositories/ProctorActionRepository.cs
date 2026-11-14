using Exam.Application.Common.Interfaces;
using Exam.Domain.Delivery;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class ProctorActionRepository : IProctorActionRepository
{
    private readonly AppDbContext _db;

    public ProctorActionRepository(AppDbContext db) => _db = db;

    public async Task<IReadOnlyList<ProctorAction>> ListByAttemptAsync(
        long attemptId,
        CancellationToken cancellationToken = default) =>
        await _db.Set<ProctorAction>()
            .AsNoTracking()
            .Where(a => a.AttemptId == attemptId)
            .OrderByDescending(a => a.CreatedAt)
            .ThenByDescending(a => a.Id)
            .ToListAsync(cancellationToken);

    public async Task AddAsync(ProctorAction action, CancellationToken cancellationToken = default) =>
        await _db.Set<ProctorAction>().AddAsync(action, cancellationToken);
}

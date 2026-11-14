using Exam.Application.Common.Interfaces;
using Exam.Domain.Delivery;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class FocusEventRepository : IFocusEventRepository
{
    private readonly AppDbContext _db;

    public FocusEventRepository(AppDbContext db) => _db = db;

    public async Task<IReadOnlyList<FocusEvent>> ListByAttemptAsync(
        long attemptId,
        CancellationToken cancellationToken = default) =>
        await _db.Set<FocusEvent>()
            .AsNoTracking()
            .Where(e => e.AttemptId == attemptId)
            .OrderBy(e => e.ServerReceivedAt)
            .ThenBy(e => e.Id)
            .ToListAsync(cancellationToken);

    public async Task AddRangeAsync(
        IReadOnlyCollection<FocusEvent> events,
        CancellationToken cancellationToken = default)
    {
        if (events.Count == 0)
        {
            return;
        }

        await _db.Set<FocusEvent>().AddRangeAsync(events, cancellationToken);
    }
}

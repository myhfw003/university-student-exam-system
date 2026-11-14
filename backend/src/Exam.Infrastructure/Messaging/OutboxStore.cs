using Exam.Application.Messaging;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Messaging;

/// <summary>Outbox 存取实现。</summary>
public sealed class OutboxStore : IOutboxStore
{
    private readonly AppDbContext _db;

    public OutboxStore(AppDbContext db) => _db = db;

    public async Task<IReadOnlyList<OutboxEnvelope>> ListPendingAsync(
        int batchSize,
        CancellationToken cancellationToken = default) =>
        await _db.Set<OutboxMessage>()
            .AsNoTracking()
            .Where(m => m.DispatchedAt == null)
            .OrderBy(m => m.Id)
            .Take(Math.Clamp(batchSize, 1, 1000))
            .Select(m => new OutboxEnvelope(
                m.Id,
                m.MessageType,
                m.Payload,
                m.OccurredAt,
                m.Attempts))
            .ToListAsync(cancellationToken);

    public async Task MarkDispatchedAsync(long id, CancellationToken cancellationToken = default)
    {
        var message = await _db.Set<OutboxMessage>().FirstOrDefaultAsync(m => m.Id == id, cancellationToken);
        if (message is null)
        {
            return;
        }

        message.MarkDispatched(DateTimeOffset.UtcNow);
        await _db.SaveChangesAsync(cancellationToken);
    }

    public async Task MarkFailedAsync(long id, string error, CancellationToken cancellationToken = default)
    {
        var message = await _db.Set<OutboxMessage>().FirstOrDefaultAsync(m => m.Id == id, cancellationToken);
        if (message is null)
        {
            return;
        }

        message.MarkFailed(error);
        await _db.SaveChangesAsync(cancellationToken);
    }
}

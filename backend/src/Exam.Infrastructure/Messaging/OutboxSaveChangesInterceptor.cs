using System.Text.Json;
using Exam.Domain.SharedKernel.Entities;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Exam.Infrastructure.Messaging;

/// <summary>
/// 领域事件出站。
/// <para>
/// 保存时把聚合上的领域事件写进 Outbox——与业务变更同一个事务，
/// 不会出现「状态改了、事件丢了」的半截状态。
/// </para>
/// </summary>
public sealed class OutboxSaveChangesInterceptor : SaveChangesInterceptor
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = false };

    public override InterceptionResult<int> SavingChanges(
        DbContextEventData eventData,
        InterceptionResult<int> result)
    {
        Capture(eventData.Context);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        Capture(eventData.Context);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    private void Capture(DbContext? db)
    {
        if (db is null)
        {
            return;
        }

        var roots = db.ChangeTracker
            .Entries()
            .Select(entry => entry.Entity)
            .OfType<AggregateRoot<long>>()
            .Where(root => root.DomainEvents.Count > 0)
            .ToList();

        foreach (var root in roots)
        {
            foreach (var domainEvent in root.DomainEvents)
            {
                var eventType = domainEvent.GetType();

                db.Set<OutboxMessage>().Add(OutboxMessage.Create(
                    eventType.FullName ?? eventType.Name,
                    JsonSerializer.Serialize(domainEvent, eventType, JsonOptions),
                    domainEvent.OccurredAt));
            }

            // 写过了就清掉：下次保存不会重复写。
            root.ClearDomainEvents();
        }
    }
}

using System.Text.Json;
using Exam.Application.Common.Interfaces;
using Exam.Domain.Audit;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Exam.Infrastructure.Audit;

/// <summary>
/// 实体字段变更的自动留痕。
/// <para>
/// 只记录实现了 <see cref="IAuditedEntity"/> 的实体；新增与业务动作由显式的
/// <see cref="Application.Common.Interfaces.IAuditRecorder"/> 记录。
/// </para>
/// <para>
/// 记录与业务变更落在同一个事务里：业务回滚，审计也回滚，不会出现
/// 「业务没改成、审计却说有改」的假象。
/// </para>
/// </summary>
public sealed class AuditSaveChangesInterceptor : SaveChangesInterceptor
{
    private static readonly JsonSerializerOptions SummaryOptions = new() { WriteIndented = false };

    private readonly ICurrentUser _currentUser;
    private readonly IClock _clock;

    public AuditSaveChangesInterceptor(ICurrentUser currentUser, IClock clock)
    {
        _currentUser = currentUser;
        _clock = clock;
    }

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

        var now = _clock.UtcNow;
        var operatorId = _currentUser.UserId;
        var operatorName = _currentUser.Username;

        var entries = db.ChangeTracker.Entries()
            .Where(e => e.State is EntityState.Modified or EntityState.Deleted)
            .Where(e => e.Entity is IAuditedEntity)
            .ToList();

        foreach (var entry in entries)
        {
            var changed = entry.State == EntityState.Deleted
                ? ["*"]
                : entry.Properties
                    .Where(p => p.IsModified && !p.Metadata.IsPrimaryKey() && p.Metadata.Name != "Version")
                    .Select(p => p.Metadata.Name)
                    .ToArray();

            if (changed.Length == 0)
            {
                continue;
            }

            // 目标类型统一小写，与显式审计记录（user / role / tag）保持一致，便于按类型过滤。
            var entityType = entry.Entity.GetType().Name.ToLowerInvariant();
            var targetId = entry.Entity is Entity<long> withId
                ? withId.Id.ToString()
                : entry.Property("Id")?.CurrentValue?.ToString();

            var log = AuditLog.Create(
                operatorId,
                operatorName,
                $"entity.{entityType}.{(entry.State == EntityState.Deleted ? "deleted" : "updated")}",
                entityType,
                targetId,
                now);

            log.WithSummary(JsonSerializer.Serialize(
                new Dictionary<string, object?>
                {
                    ["entity"] = entityType,
                    ["changes"] = changed,
                },
                SummaryOptions));

            db.Set<AuditLog>().Add(log);
        }
    }
}

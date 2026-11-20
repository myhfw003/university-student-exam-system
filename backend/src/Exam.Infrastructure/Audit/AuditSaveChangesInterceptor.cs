using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Unicode;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Security;
using Exam.Domain.Audit;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
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
    // 中文按原样写：默认编码器会把中文转成 \uXXXX，审计页上就没法看了。
    private static readonly JsonSerializerOptions SummaryOptions = new()
    {
        WriteIndented = false,
        Encoder = JavaScriptEncoder.Create(UnicodeRanges.All),
    };

    /// <summary>审计摘要里单个字段值的最大长度；超出的截断。</summary>
    private const int MaxValueLength = 200;

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
            var changes = DescribeChanges(entry);
            if (changes.Count == 0)
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
                    ["changes"] = changes,
                },
                SummaryOptions));

            db.Set<AuditLog>().Add(log);
        }
    }

    /// <summary>
    /// 描述改动的字段：改了哪些字段、改之前的值、改之后的值（FR-IAM-07 的「变更前后摘要」）。
    /// <para>
    /// 值按 §8.4 脱敏（密码与令牌全掩码、手机号前 3 后 4、邮箱保留首字符与域名），
    /// 太长的文本截断——审计是给人看的，不是数据仓库。
    /// </para>
    /// </summary>
    private static List<Dictionary<string, object?>> DescribeChanges(EntityEntry entry)
    {
        if (entry.State == EntityState.Deleted)
        {
            return [new Dictionary<string, object?> { ["field"] = "*" }];
        }

        var changes = new List<Dictionary<string, object?>>();
        foreach (var property in entry.Properties)
        {
            if (!property.IsModified) continue;
            if (property.Metadata.IsPrimaryKey()) continue;
            if (property.Metadata.Name == "Version") continue;

            changes.Add(new Dictionary<string, object?>
            {
                ["field"] = property.Metadata.Name,
                ["before"] = MaskValue(property.Metadata.Name, property.OriginalValue),
                ["after"] = MaskValue(property.Metadata.Name, property.CurrentValue),
            });
        }

        return changes;
    }

    private static object? MaskValue(string fieldName, object? value)
    {
        var masked = SensitiveDataMasker.MaskFieldValue(fieldName, value);

        // 枚举写名字而不是序号：审计是给人看的。
        if (masked is Enum enumValue)
        {
            return enumValue.ToString();
        }

        return masked is string text && text.Length > MaxValueLength
            ? text[..MaxValueLength] + "…"
            : masked;
    }
}

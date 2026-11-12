namespace Exam.Application.Common.Interfaces;

/// <summary>审计记录器。关键业务动作由应用层显式记录，实体字段变更由 EF 拦截器自动记录。</summary>
public interface IAuditRecorder
{
    Task RecordAsync(
        string action,
        string? targetType = null,
        string? targetId = null,
        IReadOnlyDictionary<string, object?>? summary = null,
        CancellationToken cancellationToken = default);
}

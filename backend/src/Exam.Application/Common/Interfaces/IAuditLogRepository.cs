using Exam.Domain.Audit;

namespace Exam.Application.Common.Interfaces;

public interface IAuditLogRepository
{
    /// <summary>
    /// 分页查询审计日志。支持按动作、目标、操作人与时间范围过滤，
    /// 排序固定为「发生时间倒序 + 主键兜底」。
    /// </summary>
    Task<IReadOnlyList<AuditLog>> SearchAsync(
        string? action,
        string? targetType,
        string? targetId,
        long? operatorId,
        DateTimeOffset? from,
        DateTimeOffset? to,
        int skip,
        int take,
        CancellationToken cancellationToken = default);

    Task<int> CountAsync(
        string? action,
        string? targetType,
        string? targetId,
        long? operatorId,
        DateTimeOffset? from,
        DateTimeOffset? to,
        CancellationToken cancellationToken = default);
}

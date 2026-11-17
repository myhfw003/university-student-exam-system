using Exam.Domain.Delivery;

namespace Exam.Application.Common.Interfaces;

/// <summary>场次负责人指派。</summary>
public interface IExamSessionAssignmentRepository
{
    /// <summary>列出某场次的全部指派。</summary>
    Task<IReadOnlyList<ExamSessionAssignment>> ListBySessionAsync(
        long examSessionId,
        CancellationToken cancellationToken = default);

    /// <summary>列出某位用户被指派的全部场次 ID。</summary>
    Task<IReadOnlyList<long>> ListSessionIdsByUserAsync(
        long userId,
        CancellationToken cancellationToken = default);

    /// <summary>批量写入指派。</summary>
    Task AddRangeAsync(
        IReadOnlyCollection<ExamSessionAssignment> assignments,
        CancellationToken cancellationToken = default);

    /// <summary>清空某场次的指派（重新指派前先清）。</summary>
    Task DeleteBySessionAsync(long examSessionId, CancellationToken cancellationToken = default);

    /// <summary>
    /// 删除某场次里不在保留清单上的指派。
    /// <para>
    /// 按差集删而不是「全删再插」：同一次保存里先插后删会撞唯一索引。
    /// </para>
    /// </summary>
    Task DeleteExceptAsync(
        long examSessionId,
        IReadOnlyCollection<long> keepUserIds,
        CancellationToken cancellationToken = default);
}

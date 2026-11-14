using Exam.Domain.Grading;

namespace Exam.Application.Common.Interfaces;

/// <summary>阅卷任务的查询条件。</summary>
public sealed record ReviewTaskSearchCriteria
{
    /// <summary>任务状态。</summary>
    public ReviewTaskStatus? Status { get; init; }

    /// <summary>所属考试场次。</summary>
    public long? ExamSessionId { get; init; }

    /// <summary>所属题目。</summary>
    public long? QuestionId { get; init; }

    /// <summary>指派给谁。</summary>
    public long? AssigneeId { get; init; }
}

public interface IReviewTaskRepository
{
    Task<ReviewTask?> GetByIdAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>按条件查询阅卷任务。</summary>
    Task<IReadOnlyList<ReviewTask>> SearchAsync(
        ReviewTaskSearchCriteria criteria,
        int skip,
        int take,
        CancellationToken cancellationToken = default);

    Task<int> CountAsync(
        ReviewTaskSearchCriteria criteria,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// 取回队列中相邻的两条任务（上一份 / 下一份）。
    /// <para>
    /// 顺序与队列一致：创建时间、主键。翻页之外还要能按顺序跳。
    /// </para>
    /// </summary>
    Task<(long? PreviousId, long? NextId)> GetNeighborIdsAsync(
        long taskId,
        ReviewTaskSearchCriteria criteria,
        CancellationToken cancellationToken = default);

    Task AddRangeAsync(IReadOnlyCollection<ReviewTask> tasks, CancellationToken cancellationToken = default);

    void Update(ReviewTask task);
}

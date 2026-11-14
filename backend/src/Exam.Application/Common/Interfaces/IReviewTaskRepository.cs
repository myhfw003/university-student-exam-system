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

    /// <summary>
    /// 取回某次作答里某道题的全部阅卷任务。
    /// <para>
    /// 综合题按步骤拆分：一步一条。定分要看这些任务是不是都评完了。
    /// </para>
    /// </summary>
    Task<IReadOnlyList<ReviewTask>> ListByAttemptQuestionAsync(
        long attemptId,
        long questionId,
        CancellationToken cancellationToken = default);

    /// <summary>按主键集合取回阅卷任务。找不到的不会出现在结果里。</summary>
    Task<IReadOnlyList<ReviewTask>> GetByIdsAsync(
        IReadOnlyCollection<long> ids,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// 取回若干次作答里若干道题的全部阅卷任务。
    /// <para>
    /// 批量定分要知道一道题还剩几步没评——这些任务就是那几步。
    /// </para>
    /// </summary>
    Task<IReadOnlyList<ReviewTask>> ListByAttemptQuestionsAsync(
        IReadOnlyCollection<long> attemptIds,
        IReadOnlyCollection<long> questionIds,
        CancellationToken cancellationToken = default);

    Task AddRangeAsync(IReadOnlyCollection<ReviewTask> tasks, CancellationToken cancellationToken = default);

    void Update(ReviewTask task);
}

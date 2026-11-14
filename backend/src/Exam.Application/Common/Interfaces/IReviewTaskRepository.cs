using Exam.Domain.Grading;

namespace Exam.Application.Common.Interfaces;

public interface IReviewTaskRepository
{
    Task<ReviewTask?> GetByIdAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>按条件查询阅卷任务。</summary>
    Task<IReadOnlyList<ReviewTask>> SearchAsync(
        ReviewTaskStatus? status,
        long? examSessionId,
        long? assigneeId,
        int skip,
        int take,
        CancellationToken cancellationToken = default);

    Task<int> CountAsync(
        ReviewTaskStatus? status,
        long? examSessionId,
        long? assigneeId,
        CancellationToken cancellationToken = default);

    Task AddRangeAsync(IReadOnlyCollection<ReviewTask> tasks, CancellationToken cancellationToken = default);

    void Update(ReviewTask task);
}

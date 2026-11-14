using Exam.Domain.Grading;

namespace Exam.Application.Common.Interfaces;

public interface IScoreResultRepository
{
    /// <summary>取回某次作答的全部评分结果。</summary>
    Task<IReadOnlyList<ScoreResult>> ListByAttemptAsync(
        long attemptId,
        CancellationToken cancellationToken = default);

    /// <summary>取回多次作答的全部评分结果。</summary>
    Task<IReadOnlyList<ScoreResult>> ListByAttemptsAsync(
        IReadOnlyCollection<long> attemptIds,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// 取回某人做过的、带某能力标签的题目的**已定分**评分结果。
    /// <para>能力画像的样本来源：只认定下来的分，建议分不算。</para>
    /// </summary>
    Task<IReadOnlyList<ScoreResult>> ListFinalByUserAndTagAsync(
        long userId,
        long abilityTagId,
        CancellationToken cancellationToken = default);

    /// <summary>取回某次作答中某道题的评分结果。</summary>
    Task<ScoreResult?> GetAsync(long attemptId, long questionId, CancellationToken cancellationToken = default);

    Task AddRangeAsync(IReadOnlyCollection<ScoreResult> results, CancellationToken cancellationToken = default);

    void Update(ScoreResult result);
}

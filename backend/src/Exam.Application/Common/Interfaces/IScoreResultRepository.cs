using Exam.Domain.Grading;

namespace Exam.Application.Common.Interfaces;

public interface IScoreResultRepository
{
    /// <summary>取回某次作答的全部评分结果。</summary>
    Task<IReadOnlyList<ScoreResult>> ListByAttemptAsync(
        long attemptId,
        CancellationToken cancellationToken = default);

    /// <summary>取回某次作答中某道题的评分结果。</summary>
    Task<ScoreResult?> GetAsync(long attemptId, long questionId, CancellationToken cancellationToken = default);

    Task AddRangeAsync(IReadOnlyCollection<ScoreResult> results, CancellationToken cancellationToken = default);

    void Update(ScoreResult result);
}

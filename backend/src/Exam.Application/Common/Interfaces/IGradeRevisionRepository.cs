using Exam.Domain.Grading;

namespace Exam.Application.Common.Interfaces;

/// <summary>改分流水。追加式：只写入，不修改、不删除。</summary>
public interface IGradeRevisionRepository
{
    /// <summary>追加一条改分流水。</summary>
    Task AddAsync(GradeRevision revision, CancellationToken cancellationToken = default);

    /// <summary>某个评分结果已有多少条改分流水。</summary>
    Task<int> CountByScoreResultAsync(long scoreResultId, CancellationToken cancellationToken = default);

    /// <summary>取回某次作答的全部改分流水，按时间正序。</summary>
    Task<IReadOnlyList<GradeRevision>> ListByAttemptAsync(
        long attemptId,
        CancellationToken cancellationToken = default);
}

using Exam.Domain.Delivery;

namespace Exam.Application.Common.Interfaces;

public interface IAnswerRevisionRepository
{
    /// <summary>取回某次作答的全部修订流水。</summary>
    Task<IReadOnlyList<AnswerRevision>> ListByAttemptAsync(
        long attemptId,
        CancellationToken cancellationToken = default);

    /// <summary>取回某道题的修订流水，按时间倒序。</summary>
    Task<IReadOnlyList<AnswerRevision>> ListByQuestionAsync(
        long attemptId,
        long questionId,
        CancellationToken cancellationToken = default);

    Task AddRangeAsync(
        IReadOnlyCollection<AnswerRevision> revisions,
        CancellationToken cancellationToken = default);
}

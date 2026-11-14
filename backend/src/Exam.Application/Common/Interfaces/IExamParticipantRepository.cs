using Exam.Domain.Delivery;

namespace Exam.Application.Common.Interfaces;

public interface IExamParticipantRepository
{
    /// <summary>取回场次的全部名单项。</summary>
    Task<IReadOnlyList<ExamParticipant>> ListBySessionAsync(
        long examSessionId,
        CancellationToken cancellationToken = default);

    /// <summary>取回某位考生在某场次的名单项。</summary>
    Task<ExamParticipant?> GetAsync(long examSessionId, long userId, CancellationToken cancellationToken = default);

    Task<int> CountBySessionAsync(long examSessionId, CancellationToken cancellationToken = default);

    Task AddRangeAsync(IReadOnlyCollection<ExamParticipant> participants, CancellationToken cancellationToken = default);

    /// <summary>清空场次名单（重新物化前先清）。</summary>
    Task DeleteBySessionAsync(long examSessionId, CancellationToken cancellationToken = default);
}

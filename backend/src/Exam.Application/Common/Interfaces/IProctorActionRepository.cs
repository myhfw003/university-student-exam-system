using Exam.Domain.Delivery;

namespace Exam.Application.Common.Interfaces;

public interface IProctorActionRepository
{
    /// <summary>取回某次作答的处置历史。</summary>
    Task<IReadOnlyList<ProctorAction>> ListByAttemptAsync(
        long attemptId,
        CancellationToken cancellationToken = default);

    Task AddAsync(ProctorAction action, CancellationToken cancellationToken = default);
}

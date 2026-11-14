using Exam.Domain.Delivery;

namespace Exam.Application.Common.Interfaces;

public interface IFocusEventRepository
{
    /// <summary>取回某次作答的焦点事件流水。</summary>
    Task<IReadOnlyList<FocusEvent>> ListByAttemptAsync(
        long attemptId,
        CancellationToken cancellationToken = default);

    Task AddRangeAsync(
        IReadOnlyCollection<FocusEvent> events,
        CancellationToken cancellationToken = default);
}

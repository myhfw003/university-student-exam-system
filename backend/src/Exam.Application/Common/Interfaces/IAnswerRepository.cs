using Exam.Domain.Delivery;

namespace Exam.Application.Common.Interfaces;

public interface IAnswerRepository
{
    Task<IReadOnlyList<Answer>> ListByAttemptAsync(long attemptId, CancellationToken cancellationToken = default);

    Task<Answer?> GetAsync(long attemptId, long questionId, CancellationToken cancellationToken = default);

    Task AddRangeAsync(IReadOnlyCollection<Answer> answers, CancellationToken cancellationToken = default);

    void Update(Answer answer);
}

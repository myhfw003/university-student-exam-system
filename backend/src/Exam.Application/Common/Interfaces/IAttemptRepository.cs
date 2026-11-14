using Exam.Domain.Delivery;

namespace Exam.Application.Common.Interfaces;

public interface IAttemptRepository
{
    Task<Attempt?> GetByIdAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>取回某人在某场考试下尚未结束的会话（幂等恢复用）。</summary>
    Task<Attempt?> GetActiveAsync(long userId, long examSessionId, CancellationToken cancellationToken = default);

    /// <summary>列出某人的全部会话。</summary>
    Task<IReadOnlyList<Attempt>> ListByUserAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>某人在某场考试下已用的尝试次数。</summary>
    Task<int> CountByUserAsync(long userId, long examSessionId, CancellationToken cancellationToken = default);

    Task AddAsync(Attempt attempt, CancellationToken cancellationToken = default);

    void Update(Attempt attempt);
}

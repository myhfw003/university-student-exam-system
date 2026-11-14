using Exam.Domain.Identity;

namespace Exam.Application.Common.Interfaces;

public interface IRefreshTokenRepository
{
    Task<RefreshToken?> GetByHashAsync(string tokenHash, CancellationToken cancellationToken = default);

    /// <summary>取回同一令牌族的全部令牌，用于复用检测时整族吊销。</summary>
    Task<IReadOnlyList<RefreshToken>> GetFamilyAsync(Guid familyId, CancellationToken cancellationToken = default);

    /// <summary>取回某个用户的全部未过期令牌。</summary>
    Task<IReadOnlyList<RefreshToken>> GetByUserAsync(long userId, CancellationToken cancellationToken = default);

    Task AddAsync(RefreshToken token, CancellationToken cancellationToken = default);

    void Update(RefreshToken token);

    /// <summary>吊销某个用户的全部有效令牌。返回吊销条数。</summary>
    Task<int> RevokeAllForUserAsync(
        long userId,
        RefreshTokenRevokeReason reason,
        DateTimeOffset now,
        CancellationToken cancellationToken = default);
}

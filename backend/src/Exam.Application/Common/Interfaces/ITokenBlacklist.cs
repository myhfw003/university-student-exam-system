namespace Exam.Application.Common.Interfaces;

/// <summary>访问令牌吊销名单。实现位于 Infrastructure（Redis）。</summary>
public interface ITokenBlacklist
{
    Task RevokeAsync(string jti, DateTimeOffset expiresAt, CancellationToken cancellationToken = default);

    Task<bool> IsRevokedAsync(string jti, CancellationToken cancellationToken = default);

    /// <summary>
    /// 吊销某个用户在该时刻之前签发的全部访问令牌。
    /// 用于「禁用用户后其令牌立即失效」——账号被禁用即刻生效，无需等令牌自然过期。
    /// </summary>
    Task RevokeUserAsync(long userId, DateTimeOffset validAfter, CancellationToken cancellationToken = default);

    /// <summary>判断某个用户在该时刻签发的令牌是否已被吊销。</summary>
    Task<bool> IsUserRevokedAsync(long userId, DateTimeOffset issuedAt, CancellationToken cancellationToken = default);
}

namespace Exam.Application.Common.Interfaces;

/// <summary>访问令牌吊销名单。实现位于 Infrastructure（Redis）。</summary>
public interface ITokenBlacklist
{
    Task RevokeAsync(string jti, DateTimeOffset expiresAt, CancellationToken cancellationToken = default);

    Task<bool> IsRevokedAsync(string jti, CancellationToken cancellationToken = default);
}

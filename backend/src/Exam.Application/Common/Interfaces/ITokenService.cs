namespace Exam.Application.Common.Interfaces;

/// <summary>访问令牌签发结果。</summary>
public sealed record AccessTokenMaterial(string Token, string Jti, DateTimeOffset ExpiresAt);

/// <summary>刷新令牌材料。原始串只出现在 Cookie 中，数据库只存哈希。</summary>
public sealed record RefreshTokenMaterial(string RawToken, string TokenHash, DateTimeOffset ExpiresAt);

/// <summary>令牌服务抽象。实现位于 Infrastructure。</summary>
public interface ITokenService
{
    AccessTokenMaterial IssueAccessToken(long userId, string username, IReadOnlyCollection<string> permissions);

    RefreshTokenMaterial IssueRefreshToken(long userId, Guid familyId);

    /// <summary>计算刷新令牌的存储哈希。</summary>
    string HashRefreshToken(string rawToken);
}

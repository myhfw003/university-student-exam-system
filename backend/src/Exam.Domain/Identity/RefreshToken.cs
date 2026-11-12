using Exam.Domain.SharedKernel.Entities;

namespace Exam.Domain.Identity;

public enum RefreshTokenRevokeReason
{
    /// <summary>被新令牌轮换取代。</summary>
    Rotated,

    /// <summary>用户主动登出。</summary>
    Logout,

    /// <summary>检测到已吊销令牌被复用（疑似盗用），整族吊销。</summary>
    ReuseDetected,

    /// <summary>密码被修改。</summary>
    PasswordChanged,

    /// <summary>账号被禁用。</summary>
    UserDisabled,

    /// <summary>令牌自然过期。</summary>
    Expired,
}

/// <summary>
/// 刷新令牌聚合根。
/// 采用"轮换 + 令牌族"模型：每次刷新签发新令牌并吊销旧令牌；
/// 若已吊销的令牌被再次使用，判定为盗用，整族吊销。
/// </summary>
public sealed class RefreshToken : Entity<long>
{
    private RefreshToken()
    {
    }

    private RefreshToken(long userId, string tokenHash, Guid familyId, DateTimeOffset expiresAt, DateTimeOffset now)
    {
        UserId = userId;
        TokenHash = tokenHash;
        FamilyId = familyId;
        ExpiresAt = expiresAt;
        CreatedAt = now;
    }

    public long UserId { get; private set; }

    public string TokenHash { get; private set; } = string.Empty;

    public Guid FamilyId { get; private set; }

    public DateTimeOffset ExpiresAt { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset? RevokedAt { get; private set; }

    public RefreshTokenRevokeReason? RevokeReason { get; private set; }

    public long? ReplacedByTokenId { get; private set; }

    public string? CreatedByIp { get; private set; }

    public string? UserAgent { get; private set; }

    public bool IsExpired(DateTimeOffset now) => ExpiresAt <= now;

    public bool IsActive(DateTimeOffset now) => RevokedAt is null && !IsExpired(now);

    public static RefreshToken Issue(
        long userId,
        string tokenHash,
        Guid familyId,
        DateTimeOffset expiresAt,
        DateTimeOffset now,
        string? createdByIp = null,
        string? userAgent = null) =>
        new(userId, tokenHash, familyId, expiresAt, now)
        {
            CreatedByIp = createdByIp,
            UserAgent = userAgent,
        };

    /// <summary>轮换：吊销本令牌并指向新令牌。令牌族保持不变。</summary>
    public void Rotate(long newTokenId, RefreshTokenRevokeReason reason, DateTimeOffset now)
    {
        if (RevokedAt is not null)
        {
            return;
        }

        RevokedAt = now;
        RevokeReason = reason;
        ReplacedByTokenId = newTokenId;
    }

    public void Revoke(RefreshTokenRevokeReason reason, DateTimeOffset now)
    {
        if (RevokedAt is not null)
        {
            return;
        }

        RevokedAt = now;
        RevokeReason = reason;
    }
}

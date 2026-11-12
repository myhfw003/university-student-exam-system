using Exam.Domain.Identity;
using Shouldly;

namespace Exam.Domain.UnitTests.Identity;

public sealed class RefreshTokenTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 12, 3, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Issue_新令牌处于有效状态()
    {
        var token = RefreshToken.Issue(1, "hash", Guid.NewGuid(), Now.AddDays(7), Now);

        token.IsActive(Now).ShouldBeTrue();
        token.RevokedAt.ShouldBeNull();
    }

    [Fact]
    public void Rotate_吊销原令牌并记录轮换原因()
    {
        var token = RefreshToken.Issue(1, "hash", Guid.NewGuid(), Now.AddDays(7), Now);

        token.Rotate(99, RefreshTokenRevokeReason.Rotated, Now);

        token.RevokedAt.ShouldBe(Now);
        token.RevokeReason.ShouldBe(RefreshTokenRevokeReason.Rotated);
        token.ReplacedByTokenId.ShouldBe(99);
    }

    [Fact]
    public void Rotate_重复调用_幂等()
    {
        var token = RefreshToken.Issue(1, "hash", Guid.NewGuid(), Now.AddDays(7), Now);
        token.Rotate(99, RefreshTokenRevokeReason.Rotated, Now);

        token.Rotate(100, RefreshTokenRevokeReason.Rotated, Now.AddMinutes(5));

        token.ReplacedByTokenId.ShouldBe(99);
        token.RevokedAt.ShouldBe(Now);
    }

    [Fact]
    public void Revoke_过期后不再有效()
    {
        var token = RefreshToken.Issue(1, "hash", Guid.NewGuid(), Now.AddDays(7), Now);
        token.Revoke(RefreshTokenRevokeReason.Logout, Now);

        token.IsActive(Now).ShouldBeFalse();
    }
}

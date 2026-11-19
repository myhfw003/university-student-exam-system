using Exam.Application.Common.Interfaces;
using Exam.Application.Identity.Commands;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using NSubstitute;
using Shouldly;

namespace Exam.Application.UnitTests.Identity;

public sealed class RefreshAccessTokenHandlerTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 12, 3, 0, 0, TimeSpan.Zero);

    private readonly IRefreshTokenRepository _refreshTokens = Substitute.For<IRefreshTokenRepository>();
    private readonly IUserRepository _users = Substitute.For<IUserRepository>();
    private readonly IUserPermissionService _permissions = Substitute.For<IUserPermissionService>();
    private readonly ITokenService _tokenService = Substitute.For<ITokenService>();
    private readonly IClock _clock = new FixedClock(Now);
    private readonly IAuditRecorder _audit = Substitute.For<IAuditRecorder>();
    private readonly IUnitOfWork _unitOfWork = Substitute.For<IUnitOfWork>();

    private RefreshAccessTokenHandler CreateHandler() =>
        new(_refreshTokens, _users, _permissions, _tokenService, _clock, _audit, _unitOfWork);

    [Fact]
    public async Task 令牌不存在_拒绝刷新()
    {
        _tokenService.HashRefreshToken(Arg.Any<string>()).Returns("hash-1");
        _refreshTokens.GetByHashAsync("hash-1", Arg.Any<CancellationToken>()).Returns((RefreshToken?)null);

        var handler = CreateHandler();
        var act = async () => await handler.Handle(new RefreshAccessTokenCommand("raw"), CancellationToken.None);

        await act.ShouldThrowAsync<BusinessRuleException>();
    }

    [Fact]
    public async Task 令牌已吊销_判定为复用并整族吊销()
    {
        _tokenService.HashRefreshToken(Arg.Any<string>()).Returns("hash-1");

        var familyId = Guid.NewGuid();
        var revoked = RefreshToken.Issue(1, "hash-1", familyId, Now.AddDays(7), Now);
        revoked.Revoke(RefreshTokenRevokeReason.Rotated, Now);

        var sibling = RefreshToken.Issue(1, "hash-2", familyId, Now.AddDays(7), Now);

        _refreshTokens.GetByHashAsync("hash-1", Arg.Any<CancellationToken>()).Returns(revoked);
        _refreshTokens.GetFamilyAsync(familyId, Arg.Any<CancellationToken>()).Returns(new[] { revoked, sibling });

        var user = User.Register("zhangsan", "张三", "hash-x", Now);
        _users.GetByIdAsync(1, Arg.Any<CancellationToken>()).Returns(user);

        var handler = CreateHandler();
        var act = async () => await handler.Handle(new RefreshAccessTokenCommand("raw"), CancellationToken.None);

        await act.ShouldThrowAsync<BusinessRuleException>();
        sibling.RevokedAt.ShouldBe(Now);
        sibling.RevokeReason.ShouldBe(RefreshTokenRevokeReason.ReuseDetected);

        // 复用检测要留审计行。
        await _audit.Received(1).RecordAsAsync(
            1L,
            "zhangsan",
            "auth.refresh_reuse",
            "user",
            "1",
            Arg.Is<IReadOnlyDictionary<string, object?>>(
                s => Equals(s["username"], "zhangsan") && Equals(s["familyId"], familyId.ToString())),
            Arg.Any<CancellationToken>());

        // 整族吊销必须落库：跟着异常回滚的话，被盗用的一族照样能刷新。
        await _unitOfWork.Received(1).SaveChangesAsync(Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task 令牌有效_轮换并签发新令牌()
    {
        _tokenService.HashRefreshToken(Arg.Any<string>()).Returns("hash-1");

        var familyId = Guid.NewGuid();
        var active = RefreshToken.Issue(1, "hash-1", familyId, Now.AddDays(7), Now);

        _refreshTokens.GetByHashAsync("hash-1", Arg.Any<CancellationToken>()).Returns(active);

        var user = User.Register("zhangsan", "张三", "hash-x", Now);
        _users.GetByIdAsync(1, Arg.Any<CancellationToken>()).Returns(user);
        _permissions.GetPermissionCodesAsync(Arg.Any<long>(), Arg.Any<CancellationToken>()).Returns([]);
        _tokenService.IssueAccessToken(Arg.Any<long>(), Arg.Any<string>(), Arg.Any<IReadOnlyCollection<string>>(), Arg.Any<bool>())
            .Returns(new AccessTokenMaterial("new-access", "jti-2", Now.AddMinutes(15)));
        _tokenService.IssueRefreshToken(Arg.Any<long>(), Arg.Any<Guid>())
            .Returns(new RefreshTokenMaterial("new-refresh", "hash-2", Now.AddDays(7)));

        var handler = CreateHandler();
        var result = await handler.Handle(new RefreshAccessTokenCommand("raw"), CancellationToken.None);

        result.AccessToken.ShouldBe("new-access");
        result.RefreshToken.ShouldBe("new-refresh");
        active.RevokedAt.ShouldBe(Now);
        active.RevokeReason.ShouldBe(RefreshTokenRevokeReason.Rotated);
        await _refreshTokens.Received(1).AddAsync(
            Arg.Is<RefreshToken>(t => t.FamilyId == familyId),
            Arg.Any<CancellationToken>());
    }
}

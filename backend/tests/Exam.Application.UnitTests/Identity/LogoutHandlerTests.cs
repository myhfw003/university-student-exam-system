using Exam.Application.Common.Interfaces;
using Exam.Application.Identity.Commands;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using NSubstitute;
using Shouldly;

namespace Exam.Application.UnitTests.Identity;

/// <summary>登出：吊销令牌族、把访问令牌加入黑名单，并留一行审计。</summary>
public sealed class LogoutHandlerTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 19, 3, 0, 0, TimeSpan.Zero);

    private readonly IRefreshTokenRepository _refreshTokens = Substitute.For<IRefreshTokenRepository>();
    private readonly ITokenBlacklist _blacklist = Substitute.For<ITokenBlacklist>();
    private readonly ITokenService _tokenService = Substitute.For<ITokenService>();
    private readonly IClock _clock = new FixedClock(Now);
    private readonly IAuditRecorder _audit = Substitute.For<IAuditRecorder>();
    private readonly ICurrentUser _currentUser = Substitute.For<ICurrentUser>();

    private LogoutHandler CreateHandler() =>
        new(_refreshTokens, _blacklist, _tokenService, _clock, _audit, _currentUser);

    [Fact]
    public async Task 登出写审计行()
    {
        _currentUser.UserId.Returns(7L);
        _currentUser.Username.Returns("zhangsan");

        var handler = CreateHandler();
        await handler.Handle(new LogoutCommand(null, "jti-1"), CancellationToken.None);

        await _audit.Received(1).RecordAsync(
            "auth.logout",
            "user",
            "7",
            Arg.Is<IReadOnlyDictionary<string, object?>>(
                s => Equals(s["username"], "zhangsan") && Equals(s["refreshTokenRevoked"], false)),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task 带刷新令牌_吊销整族并在摘要里记下()
    {
        _currentUser.UserId.Returns(7L);
        _currentUser.Username.Returns("zhangsan");
        _tokenService.HashRefreshToken("raw").Returns("hash-1");

        var familyId = Guid.NewGuid();
        var active = RefreshToken.Issue(7, "hash-1", familyId, Now.AddDays(7), Now);
        _refreshTokens.GetByHashAsync("hash-1", Arg.Any<CancellationToken>()).Returns(active);
        _refreshTokens.GetFamilyAsync(familyId, Arg.Any<CancellationToken>()).Returns(new[] { active });

        var handler = CreateHandler();
        await handler.Handle(new LogoutCommand("raw", "jti-1"), CancellationToken.None);

        active.RevokedAt.ShouldBe(Now);
        active.RevokeReason.ShouldBe(RefreshTokenRevokeReason.Logout);

        await _audit.Received(1).RecordAsync(
            "auth.logout",
            "user",
            "7",
            Arg.Is<IReadOnlyDictionary<string, object?>>(s => Equals(s["refreshTokenRevoked"], true)),
            Arg.Any<CancellationToken>());
    }
}

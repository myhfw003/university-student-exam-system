using Exam.Application.Common.Interfaces;
using Exam.Application.Identity.Services;
using Exam.Application.Identity.Commands;
using Exam.Application.Identity.Contracts;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using NSubstitute;
using Shouldly;

namespace Exam.Application.UnitTests.Identity;

/// <summary>测试用密码验证器。</summary>
internal sealed class StubPasswordVerifier : IPasswordVerifier
{
    public string Hash(string password) => $"hash:{password}";

    public PasswordVerificationResult Verify(string password, string passwordHash) =>
        passwordHash == $"hash:{password}" ? PasswordVerificationResult.Success : PasswordVerificationResult.Failed;
    public string GenerateInitialPassword() => "InitPassw0rd";

}

/// <summary>测试用时钟。</summary>
internal sealed class FixedClock : IClock
{
    public FixedClock(DateTimeOffset now) => UtcNow = now;

    public DateTimeOffset UtcNow { get; }
}

public sealed class LoginHandlerTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 12, 3, 0, 0, TimeSpan.Zero);

    private readonly IUserRepository _users = Substitute.For<IUserRepository>();
    private readonly IRefreshTokenRepository _refreshTokens = Substitute.For<IRefreshTokenRepository>();
    private readonly IUserPermissionService _permissions = Substitute.For<IUserPermissionService>();
    private readonly ITokenService _tokenService = Substitute.For<ITokenService>();
    private readonly IClock _clock = new FixedClock(Now);
    private readonly IRequestContext _requestContext = Substitute.For<IRequestContext>();

    private readonly UserOrganizationResolver _organization = new(
        Substitute.For<IUserTagRepository>(),
        Substitute.For<ITagRepository>());

    private LoginHandler CreateHandler() =>
        new(_users, _refreshTokens, _permissions, _tokenService, new StubPasswordVerifier(), _clock, _requestContext, _organization);

    private void ArrangeExistingUser(string username = "zhangsan", string password = "Passw0rd!")
    {
        var user = User.Register(username, "张三", $"hash:{password}", Now);
        _users.GetByUsernameAsync(Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns(user);
        _users.GetByIdAsync(Arg.Any<long>(), Arg.Any<CancellationToken>()).Returns(user);
    }

    [Fact]
    public async Task 账号不存在_提示与密码错误一致()
    {
        _users.GetByUsernameAsync(Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns((User?)null);

        var handler = CreateHandler();
        var act = async () => await handler.Handle(new LoginCommand("nobody", "whatever"), CancellationToken.None);

        var ex = await act.ShouldThrowAsync<BusinessRuleException>();
        ex.Message.ShouldBe("账号或密码错误。");
    }

    [Fact]
    public async Task 密码错误_提示与账号不存在一致()
    {
        ArrangeExistingUser();

        var handler = CreateHandler();
        var act = async () => await handler.Handle(new LoginCommand("zhangsan", "wrong"), CancellationToken.None);

        var ex = await act.ShouldThrowAsync<BusinessRuleException>();
        ex.Message.ShouldBe("账号或密码错误。");
    }

    [Fact]
    public async Task 登录成功_返回访问令牌与用户档案()
    {
        ArrangeExistingUser();
        _permissions.GetPermissionCodesAsync(Arg.Any<long>(), Arg.Any<CancellationToken>())
            .Returns(new[] { "attempt:take" });
        _permissions.GetRoleCodesAsync(Arg.Any<long>(), Arg.Any<CancellationToken>())
            .Returns(new[] { "student" });
        _tokenService.IssueAccessToken(Arg.Any<long>(), Arg.Any<string>(), Arg.Any<IReadOnlyCollection<string>>())
            .Returns(new AccessTokenMaterial("access-token", "jti-1", Now.AddMinutes(15)));
        _tokenService.IssueRefreshToken(Arg.Any<long>(), Arg.Any<Guid>())
            .Returns(new RefreshTokenMaterial("refresh-token", "hash-1", Now.AddDays(7)));

        var handler = CreateHandler();
        var result = await handler.Handle(new LoginCommand("zhangsan", "Passw0rd!"), CancellationToken.None);

        result.AccessToken.ShouldBe("access-token");
        result.TokenType.ShouldBe("Bearer");
        result.User.Username.ShouldBe("zhangsan");
        result.User.Roles.ShouldContain("student");
        result.User.Permissions.ShouldContain("attempt:take");
        result.RefreshToken.ShouldBe("refresh-token");
    }

    [Fact]
    public async Task 登录成功_签发刷新令牌并入库()
    {
        ArrangeExistingUser();
        _permissions.GetPermissionCodesAsync(Arg.Any<long>(), Arg.Any<CancellationToken>()).Returns([]);
        _permissions.GetRoleCodesAsync(Arg.Any<long>(), Arg.Any<CancellationToken>()).Returns([]);
        _tokenService.IssueAccessToken(Arg.Any<long>(), Arg.Any<string>(), Arg.Any<IReadOnlyCollection<string>>())
            .Returns(new AccessTokenMaterial("access-token", "jti-1", Now.AddMinutes(15)));
        _tokenService.IssueRefreshToken(Arg.Any<long>(), Arg.Any<Guid>())
            .Returns(new RefreshTokenMaterial("refresh-token", "hash-1", Now.AddDays(7)));

        var handler = CreateHandler();
        await handler.Handle(new LoginCommand("zhangsan", "Passw0rd!"), CancellationToken.None);

        await _refreshTokens.Received(1).AddAsync(
            Arg.Is<RefreshToken>(t => t.TokenHash == "hash-1"),
            Arg.Any<CancellationToken>());
    }
}

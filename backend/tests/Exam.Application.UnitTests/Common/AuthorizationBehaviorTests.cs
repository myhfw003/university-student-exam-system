using Exam.Application.Common.Behaviors;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using MediatR;
using NSubstitute;
using Shouldly;

namespace Exam.Application.UnitTests.Common;

public sealed class AuthorizationBehaviorTests
{
    private sealed record SecuredRequest(string[] Required) : IAuthorizableRequest
    {
        public IReadOnlyCollection<string> RequiredPermissions => Required;
    }

    private sealed record OpenRequest : IAuthorizableRequest
    {
        public IReadOnlyCollection<string> RequiredPermissions => [];
    }

    private static RequestHandlerDelegate<TResponse> Next<TResponse>(TResponse response) =>
        () => Task.FromResult(response);

    private static IPermissionProvider ProviderWith(params string[] permissions)
    {
        var provider = Substitute.For<IPermissionProvider>();
        provider.GetPermissionsAsync(Arg.Any<long>(), Arg.Any<CancellationToken>())
            .Returns(new HashSet<string>(permissions, StringComparer.Ordinal));
        return provider;
    }

    [Fact]
    public async Task 未认证_拒绝执行()
    {
        var currentUser = Substitute.For<ICurrentUser>();
        currentUser.IsAuthenticated.Returns(false);

        var behavior = new AuthorizationBehavior<SecuredRequest, Unit>(currentUser, ProviderWith("paper:publish"));

        var act = async () => await behavior.Handle(
            new SecuredRequest(["paper:publish"]),
            Next(Unit.Value),
            CancellationToken.None);

        await act.ShouldThrowAsync<ForbiddenException>();
    }

    [Fact]
    public async Task 缺少权限_拒绝执行并说明缺哪个权限()
    {
        var currentUser = Substitute.For<ICurrentUser>();
        currentUser.IsAuthenticated.Returns(true);
        currentUser.UserId.Returns(7L);

        var behavior = new AuthorizationBehavior<SecuredRequest, Unit>(
            currentUser,
            ProviderWith("paper:read"));

        var act = async () => await behavior.Handle(
            new SecuredRequest(["paper:read", "paper:publish"]),
            Next(Unit.Value),
            CancellationToken.None);

        var ex = await act.ShouldThrowAsync<ForbiddenException>();
        ex.Message.ShouldContain("paper:publish");
    }

    [Fact]
    public async Task 权限齐备_放行()
    {
        var currentUser = Substitute.For<ICurrentUser>();
        currentUser.IsAuthenticated.Returns(true);
        currentUser.UserId.Returns(7L);

        var behavior = new AuthorizationBehavior<SecuredRequest, Unit>(
            currentUser,
            ProviderWith("paper:publish"));

        var response = await behavior.Handle(
            new SecuredRequest(["paper:publish"]),
            Next(Unit.Value),
            CancellationToken.None);

        response.ShouldBe(Unit.Value);
    }

    [Fact]
    public async Task 未声明权限的请求_只校验登录态()
    {
        var currentUser = Substitute.For<ICurrentUser>();
        currentUser.IsAuthenticated.Returns(true);
        currentUser.UserId.Returns(7L);

        var behavior = new AuthorizationBehavior<OpenRequest, Unit>(currentUser, ProviderWith());

        var response = await behavior.Handle(new OpenRequest(), Next(Unit.Value), CancellationToken.None);

        response.ShouldBe(Unit.Value);
    }

    [Fact]
    public async Task 权限取自实时权限集_而不是令牌声明()
    {
        var currentUser = Substitute.For<ICurrentUser>();
        currentUser.IsAuthenticated.Returns(true);
        currentUser.UserId.Returns(7L);

        // 令牌里没有 paper:publish，但实时权限集里有——角色刚被授予。
        var provider = ProviderWith("paper:publish");

        var behavior = new AuthorizationBehavior<SecuredRequest, Unit>(currentUser, provider);

        var response = await behavior.Handle(
            new SecuredRequest(["paper:publish"]),
            Next(Unit.Value),
            CancellationToken.None);

        response.ShouldBe(Unit.Value);
        await provider.Received(1).GetPermissionsAsync(7L, Arg.Any<CancellationToken>());
    }
}

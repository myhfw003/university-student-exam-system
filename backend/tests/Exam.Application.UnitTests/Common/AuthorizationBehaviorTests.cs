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

    [Fact]
    public async Task 未认证_拒绝执行()
    {
        var currentUser = Substitute.For<ICurrentUser>();
        currentUser.IsAuthenticated.Returns(false);

        var behavior = new AuthorizationBehavior<SecuredRequest, Unit>(currentUser);

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
        currentUser.HasPermission("paper:publish").Returns(false);
        currentUser.HasPermission("paper:read").Returns(true);

        var behavior = new AuthorizationBehavior<SecuredRequest, Unit>(currentUser);

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
        currentUser.HasPermission("paper:publish").Returns(true);

        var behavior = new AuthorizationBehavior<SecuredRequest, Unit>(currentUser);

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

        var behavior = new AuthorizationBehavior<OpenRequest, Unit>(currentUser);

        var response = await behavior.Handle(new OpenRequest(), Next(Unit.Value), CancellationToken.None);

        response.ShouldBe(Unit.Value);
    }
}

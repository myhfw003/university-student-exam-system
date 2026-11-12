using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using MediatR;

namespace Exam.Application.Common.Behaviors;

/// <summary>
/// 权限校验。请求实现 <see cref="IAuthorizableRequest"/> 时，
/// 必须已认证且拥有全部声明的权限码。
/// </summary>
public sealed class AuthorizationBehavior<TRequest, TResponse> : IPipelineBehavior<TRequest, TResponse>
    where TRequest : notnull
{
    private readonly ICurrentUser _currentUser;

    public AuthorizationBehavior(ICurrentUser currentUser) => _currentUser = currentUser;

    public Task<TResponse> Handle(
        TRequest request,
        RequestHandlerDelegate<TResponse> next,
        CancellationToken cancellationToken)
    {
        if (request is not IAuthorizableRequest authorizable)
        {
            return next();
        }

        if (!_currentUser.IsAuthenticated)
        {
            throw new ForbiddenException("请先登录。");
        }

        var missing = authorizable.RequiredPermissions
            .Where(code => !_currentUser.HasPermission(code))
            .ToArray();

        if (missing.Length > 0)
        {
            throw new ForbiddenException($"缺少权限：{string.Join("、", missing)}。");
        }

        return next();
    }
}

using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using MediatR;

namespace Exam.Application.Common.Behaviors;

/// <summary>
/// 权限校验。请求实现 <see cref="IAuthorizableRequest"/> 时，
/// 必须已认证且拥有全部声明的权限码。
/// <para>
/// 权限取自实时权限集而不是令牌里的声明——角色调整后必须在下一次请求即生效。
/// </para>
/// </summary>
public sealed class AuthorizationBehavior<TRequest, TResponse> : IPipelineBehavior<TRequest, TResponse>
    where TRequest : notnull
{
    private readonly ICurrentUser _currentUser;
    private readonly IPermissionProvider _permissions;

    public AuthorizationBehavior(ICurrentUser currentUser, IPermissionProvider permissions)
    {
        _currentUser = currentUser;
        _permissions = permissions;
    }

    public async Task<TResponse> Handle(
        TRequest request,
        RequestHandlerDelegate<TResponse> next,
        CancellationToken cancellationToken)
    {
        if (request is not IAuthorizableRequest authorizable)
        {
            return await next();
        }

        if (!_currentUser.IsAuthenticated || _currentUser.UserId is not { } userId)
        {
            throw new ForbiddenException("请先登录。");
        }

        // 强制改密：管理员重置密码或导入名单后，用户必须先改密。
        // 放行的只有标记了 IExemptFromPasswordChange 的请求（改密、看本人档案、登出）。
        if (_currentUser.MustChangePassword && request is not IExemptFromPasswordChange)
        {
            throw new ForbiddenException("请先修改初始密码，再继续使用。");
        }

        var required = authorizable.RequiredPermissions;
        if (required.Count == 0)
        {
            return await next();
        }

        var granted = await _permissions.GetPermissionsAsync(userId, cancellationToken);
        var missing = required.Where(code => !granted.Contains(code)).ToArray();

        if (missing.Length > 0)
        {
            throw new ForbiddenException($"缺少权限：{string.Join("、", missing)}。");
        }

        return await next();
    }
}

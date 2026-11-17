using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Identity.Contracts;
using Exam.Application.Identity.Services;
using MediatR;

namespace Exam.Application.Identity.Queries;

/// <summary>查询当前登录用户的档案与权限。</summary>
public sealed record GetCurrentUserQuery : IAppQuery<UserProfileDto?>, IAuthorizableRequest, IExemptFromPasswordChange
{
    public IReadOnlyCollection<string> RequiredPermissions { get; } = [];
}

public sealed class GetCurrentUserHandler : IRequestHandler<GetCurrentUserQuery, UserProfileDto?>
{
    private readonly ICurrentUser _currentUser;
    private readonly IUserPermissionService _permissions;
    private readonly IUserRepository _users;
    private readonly UserOrganizationResolver _organization;

    public GetCurrentUserHandler(
        ICurrentUser currentUser,
        IUserPermissionService permissions,
        IUserRepository users,
        UserOrganizationResolver organization)
    {
        _currentUser = currentUser;
        _permissions = permissions;
        _users = users;
        _organization = organization;
    }

    public async Task<UserProfileDto?> Handle(GetCurrentUserQuery request, CancellationToken cancellationToken)
    {
        if (!_currentUser.IsAuthenticated || _currentUser.UserId is not { } userId)
        {
            return null;
        }

        var roleCodes = await _permissions.GetRoleCodesAsync(userId, cancellationToken);
        var permissionCodes = await _permissions.GetPermissionCodesAsync(userId, cancellationToken);

        // 令牌里只有登录名，真实姓名与「需修改密码」标记要从库里取。
        var user = await _users.GetByIdAsync(userId, cancellationToken);

        var organization = await _organization.ResolveAsync(userId, cancellationToken);

        return new UserProfileDto(
            userId,
            user?.Username ?? _currentUser.Username ?? string.Empty,
            user?.DisplayName ?? _currentUser.Username ?? string.Empty,
            roleCodes.ToList(),
            permissionCodes.ToList(),
            organization.Tags.Select(t => new OrganizationTagDto(t.Id, t.Name)).ToList(),
            user?.MustChangePassword ?? false);
    }
}

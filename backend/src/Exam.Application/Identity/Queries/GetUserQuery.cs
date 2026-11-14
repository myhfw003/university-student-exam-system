using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Identity.Contracts;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Exceptions;
using MediatR;

namespace Exam.Application.Identity.Queries;

/// <summary>取回单个用户详情。本人可读自己的档案。</summary>
public sealed record GetUserQuery(long Id) : IAppQuery<UserDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [];
}

public sealed class GetUserHandler : IRequestHandler<GetUserQuery, UserDetailDto>
{
    private readonly IUserRepository _users;
    private readonly IUserRoleRepository _userRoles;
    private readonly IRoleRepository _roles;
    private readonly IPermissionProvider _permissions;
    private readonly ICurrentUser _currentUser;

    public GetUserHandler(
        IUserRepository users,
        IUserRoleRepository userRoles,
        IRoleRepository roles,
        IPermissionProvider permissions,
        ICurrentUser currentUser)
    {
        _users = users;
        _userRoles = userRoles;
        _roles = roles;
        _permissions = permissions;
        _currentUser = currentUser;
    }

    public async Task<UserDetailDto> Handle(GetUserQuery request, CancellationToken cancellationToken)
    {
        var isSelf = _currentUser.UserId == request.Id;
        if (!isSelf)
        {
            var granted = await _permissions.GetPermissionsAsync(
                _currentUser.UserId ?? 0, cancellationToken);
            if (!granted.Contains(PermissionCatalog.UserRead))
            {
                throw new ForbiddenException("没有查看该用户的权限。");
            }
        }

        var user = await _users.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("用户不存在。");

        var roleIds = await _userRoles.GetRoleIdsAsync(user.Id, cancellationToken);
        var roleCodes = new List<string>();
        foreach (var roleId in roleIds)
        {
            var role = await _roles.GetByIdAsync(roleId, cancellationToken);
            if (role is not null)
            {
                roleCodes.Add(role.Code);
            }
        }

        var permissions = await _permissions.GetPermissionsAsync(user.Id, cancellationToken);

        return new UserDetailDto(
            new UserSummaryDto(
                user.Id,
                user.Username,
                user.DisplayName,
                user.Email,
                user.Phone,
                user.Status.ToString(),
                user.MustChangePassword,
                roleCodes,
                user.CreatedAt,
                user.LastLoginAt),
            roleIds,
            permissions.ToList());
    }
}

/// <summary>列出全部角色及其权限点。</summary>
public sealed record ListRolesQuery : IAppQuery<IReadOnlyList<RoleDto>>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.RoleRead];
}

public sealed class ListRolesHandler : IRequestHandler<ListRolesQuery, IReadOnlyList<RoleDto>>
{
    private readonly IRoleRepository _roles;
    private readonly IRolePermissionRepository _rolePermissions;
    private readonly IPermissionRepository _permissions;

    public ListRolesHandler(
        IRoleRepository roles,
        IRolePermissionRepository rolePermissions,
        IPermissionRepository permissions)
    {
        _roles = roles;
        _rolePermissions = rolePermissions;
        _permissions = permissions;
    }

    public async Task<IReadOnlyList<RoleDto>> Handle(ListRolesQuery request, CancellationToken cancellationToken)
    {
        var roles = await _roles.ListAsync(cancellationToken);
        var result = new List<RoleDto>(roles.Count);

        foreach (var role in roles)
        {
            var permissionIds = await _rolePermissions.GetPermissionIdsAsync([role.Id], cancellationToken);
            var codes = await _permissions.GetCodesAsync(permissionIds, cancellationToken);

            result.Add(new RoleDto(
                role.Id,
                role.Code,
                role.Name,
                role.Description,
                role.IsSystem,
                codes.OrderBy(c => c, StringComparer.Ordinal).ToList()));
        }

        return result;
    }
}

/// <summary>列出全部权限点。管理端角色权限矩阵用。</summary>
public sealed record ListPermissionsQuery : IAppQuery<IReadOnlyList<PermissionDto>>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.RoleRead];
}

public sealed class ListPermissionsHandler : IRequestHandler<ListPermissionsQuery, IReadOnlyList<PermissionDto>>
{
    private readonly IPermissionRepository _permissions;

    public ListPermissionsHandler(IPermissionRepository permissions) => _permissions = permissions;

    public async Task<IReadOnlyList<PermissionDto>> Handle(
        ListPermissionsQuery request,
        CancellationToken cancellationToken)
    {
        var permissions = await _permissions.ListAsync(cancellationToken);

        return permissions
            .Select(p => new PermissionDto(p.Code, p.Name, p.Module, p.Description))
            .ToList();
    }
}

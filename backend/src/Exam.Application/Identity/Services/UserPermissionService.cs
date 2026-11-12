using Exam.Application.Common.Interfaces;

namespace Exam.Application.Identity.Services;

/// <summary>基于关联表查询用户权限与角色。</summary>
public sealed class UserPermissionService : IUserPermissionService
{
    private readonly IUserRoleRepository _userRoles;
    private readonly IRolePermissionRepository _rolePermissions;
    private readonly IPermissionRepository _permissions;
    private readonly IRoleRepository _roles;

    public UserPermissionService(
        IUserRoleRepository userRoles,
        IRolePermissionRepository rolePermissions,
        IPermissionRepository permissions,
        IRoleRepository roles)
    {
        _userRoles = userRoles;
        _rolePermissions = rolePermissions;
        _permissions = permissions;
        _roles = roles;
    }

    public async Task<IReadOnlyCollection<string>> GetPermissionCodesAsync(
        long userId,
        CancellationToken cancellationToken = default)
    {
        var roleIds = await _userRoles.GetRoleIdsAsync(userId, cancellationToken);
        if (roleIds.Count == 0)
        {
            return [];
        }

        var permissionIds = await _rolePermissions.GetPermissionIdsAsync(roleIds, cancellationToken);
        if (permissionIds.Count == 0)
        {
            return [];
        }

        var codes = await _permissions.GetCodesAsync(permissionIds, cancellationToken);
        return codes.Distinct(StringComparer.Ordinal).ToArray();
    }

    public async Task<IReadOnlyCollection<string>> GetRoleCodesAsync(
        long userId,
        CancellationToken cancellationToken = default)
    {
        var roleIds = await _userRoles.GetRoleIdsAsync(userId, cancellationToken);
        if (roleIds.Count == 0)
        {
            return [];
        }

        var codes = new List<string>(roleIds.Count);
        foreach (var roleId in roleIds)
        {
            var role = await _roles.GetByIdAsync(roleId, cancellationToken);
            if (role is not null)
            {
                codes.Add(role.Code);
            }
        }

        return codes.Distinct(StringComparer.Ordinal).ToArray();
    }
}

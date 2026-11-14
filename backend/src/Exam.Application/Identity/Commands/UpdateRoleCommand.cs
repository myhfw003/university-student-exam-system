using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Identity.Contracts;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Identity.Commands;

/// <summary>修改角色。系统内置角色只能调整权限，不能改编码。</summary>
public sealed record UpdateRoleCommand(
    long Id,
    string Name,
    string? Description,
    IReadOnlyList<string> PermissionCodes) : IAppCommand<RoleDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.RoleWrite];
}

public sealed class UpdateRoleCommandValidator : AbstractValidator<UpdateRoleCommand>
{
    public UpdateRoleCommandValidator()
    {
        RuleFor(x => x.Id).GreaterThan(0).WithMessage("角色 ID 不合法。");

        RuleFor(x => x.Name)
            .NotEmpty().WithMessage("请填写角色名称。")
            .MaximumLength(64).WithMessage("角色名称长度不能超过 64 位。");
    }
}

public sealed class UpdateRoleHandler : IRequestHandler<UpdateRoleCommand, RoleDto>
{
    private readonly IRoleRepository _roles;
    private readonly IPermissionRepository _permissions;
    private readonly IRolePermissionRepository _rolePermissions;
    private readonly IUserRoleRepository _userRoles;
    private readonly IPermissionProvider _permissionProvider;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public UpdateRoleHandler(
        IRoleRepository roles,
        IPermissionRepository permissions,
        IRolePermissionRepository rolePermissions,
        IUserRoleRepository userRoles,
        IPermissionProvider permissionProvider,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _roles = roles;
        _permissions = permissions;
        _rolePermissions = rolePermissions;
        _userRoles = userRoles;
        _permissionProvider = permissionProvider;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<RoleDto> Handle(UpdateRoleCommand request, CancellationToken cancellationToken)
    {
        var role = await _roles.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("角色不存在。");

        var codes = request.PermissionCodes.Distinct(StringComparer.Ordinal).ToList();
        var permissions = await _permissions.GetByCodesAsync(codes, cancellationToken);
        var found = permissions.Select(p => p.Code).ToHashSet(StringComparer.Ordinal);
        var missing = codes.Where(c => !found.Contains(c)).ToArray();
        if (missing.Length > 0)
        {
            throw new BusinessRuleException($"存在未知权限点：{string.Join("、", missing)}。");
        }

        var now = _clock.UtcNow;
        role.Rename(request.Name, now, _currentUser.UserId);
        role.ChangeDescription(request.Description, now, _currentUser.UserId);
        _roles.Update(role);

        var current = await _rolePermissions.GetByRoleAsync(role.Id, cancellationToken);
        var targetPermissionIds = permissions.Select(p => p.Id).ToHashSet();

        foreach (var link in current.Where(l => !targetPermissionIds.Contains(l.PermissionId)))
        {
            _rolePermissions.Remove(link);
        }

        var existingPermissionIds = current.Select(l => l.PermissionId).ToHashSet();
        foreach (var permission in permissions.Where(p => !existingPermissionIds.Contains(p.Id)))
        {
            await _rolePermissions.AddAsync(
                RolePermission.Create(role.Id, permission.Id, now),
                cancellationToken);
        }

        // 角色权限变了，持有该角色的用户的权限集必须立刻重算。
        var affectedUserIds = await _userRoles.GetUserIdsByRoleAsync(role.Id, cancellationToken);
        foreach (var userId in affectedUserIds)
        {
            await _permissionProvider.InvalidateAsync(userId, cancellationToken);
        }

        await _audit.RecordAsync(
            "role.update",
            "role",
            role.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["code"] = role.Code,
                ["permissionCodes"] = codes,
                ["affectedUserCount"] = affectedUserIds.Count,
            },
            cancellationToken);

        return new RoleDto(
            role.Id,
            role.Code,
            role.Name,
            role.Description,
            role.IsSystem,
            codes);
    }
}

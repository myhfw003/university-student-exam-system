using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Common.Security;
using Exam.Application.Identity.Contracts;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Identity.Commands;

/// <summary>覆盖式设置用户的角色集合。角色变更在下一次请求即生效。</summary>
public sealed record AssignUserRolesCommand(long UserId, IReadOnlyList<long> RoleIds)
    : IAppCommand<UserDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.RoleWrite];
}

public sealed class AssignUserRolesCommandValidator : AbstractValidator<AssignUserRolesCommand>
{
    public AssignUserRolesCommandValidator()
    {
        RuleFor(x => x.UserId).GreaterThan(0).WithMessage("用户 ID 不合法。");
    }
}

public sealed class AssignUserRolesHandler : IRequestHandler<AssignUserRolesCommand, UserDetailDto>
{
    private readonly IUserRepository _users;
    private readonly IUserRoleRepository _userRoles;
    private readonly IRoleRepository _roles;
    private readonly IPermissionProvider _permissions;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public AssignUserRolesHandler(
        IUserRepository users,
        IUserRoleRepository userRoles,
        IRoleRepository roles,
        IPermissionProvider permissions,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _users = users;
        _userRoles = userRoles;
        _roles = roles;
        _permissions = permissions;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<UserDetailDto> Handle(AssignUserRolesCommand request, CancellationToken cancellationToken)
    {
        var user = await _users.GetByIdAsync(request.UserId, cancellationToken)
            ?? throw new NotFoundException("用户不存在。");

        var targetRoleIds = new List<long>();
        foreach (var roleId in request.RoleIds.Distinct())
        {
            var role = await _roles.GetByIdAsync(roleId, cancellationToken);
            if (role is null)
            {
                throw new BusinessRuleException($"角色不存在：{roleId}。");
            }

            targetRoleIds.Add(roleId);
        }

        var current = await _userRoles.GetByUserAsync(request.UserId, cancellationToken);
        var currentRoleIds = current.Select(r => r.RoleId).ToHashSet();
        var targetSet = targetRoleIds.ToHashSet();
        var now = _clock.UtcNow;

        foreach (var link in current.Where(r => !targetSet.Contains(r.RoleId)))
        {
            _userRoles.Remove(link);
        }

        foreach (var roleId in targetSet.Where(id => !currentRoleIds.Contains(id)))
        {
            await _userRoles.AddAsync(UserRole.Create(request.UserId, roleId, _currentUser.UserId, now), cancellationToken);
        }

        // 角色变了，权限集必须立刻重算——否则要等到令牌过期才生效。
        // 先落库再失效：反过来做的话，失效与重新缓存之间可能读到尚未提交的角色关联。
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        await _permissions.InvalidateAsync(request.UserId, cancellationToken);

        await _audit.RecordAsync(
            "user.assign-roles",
            "user",
            user.Id.ToString(),
            new Dictionary<string, object?> { ["roleIds"] = targetRoleIds },
            cancellationToken);

        var roleCodes = new List<string>();
        foreach (var roleId in targetRoleIds)
        {
            var role = await _roles.GetByIdAsync(roleId, cancellationToken);
            if (role is not null)
            {
                roleCodes.Add(role.Code);
            }
        }

        var permissions = await _permissions.GetPermissionsAsync(request.UserId, cancellationToken);

        return new UserDetailDto(
            new UserSummaryDto(
                user.Id,
                user.Username,
                user.DisplayName,
                user.Email,
                SensitiveDataMasker.MaskPhone(user.Phone),
                user.Status.ToStorage(),
                user.MustChangePassword,
                roleCodes,
                user.CreatedAt,
                user.LastLoginAt),
            targetRoleIds,
            permissions.ToList());
    }
}

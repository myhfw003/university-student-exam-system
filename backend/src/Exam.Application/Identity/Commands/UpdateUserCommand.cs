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

/// <summary>修改用户档案与状态。禁用会立即吊销该用户的全部令牌。</summary>
public sealed record UpdateUserCommand(
    long Id,
    string DisplayName,
    string? Email,
    string? Phone,
    string? Status,
    string? DisableReason) : IAppCommand<UserDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.UserWrite];
}

public sealed class UpdateUserCommandValidator : AbstractValidator<UpdateUserCommand>
{
    public UpdateUserCommandValidator()
    {
        RuleFor(x => x.Id).GreaterThan(0).WithMessage("用户 ID 不合法。");

        RuleFor(x => x.DisplayName)
            .NotEmpty().WithMessage("请填写姓名。")
            .MaximumLength(64).WithMessage("姓名长度不能超过 64 位。");

        RuleFor(x => x.Email)
            .MaximumLength(256).WithMessage("邮箱长度不能超过 256 位。");

        RuleFor(x => x.Phone)
            .MaximumLength(32).WithMessage("手机号长度不能超过 32 位。");

        RuleFor(x => x.Status)
            .Must(s => s is null or "active" or "disabled")
            .WithMessage("用户状态只能是 active 或 disabled。");
    }
}

public sealed class UpdateUserHandler : IRequestHandler<UpdateUserCommand, UserDetailDto>
{
    private readonly IUserRepository _users;
    private readonly IUserRoleRepository _userRoles;
    private readonly IRoleRepository _roles;
    private readonly IPermissionProvider _permissions;
    private readonly IRefreshTokenRepository _refreshTokens;
    private readonly ITokenBlacklist _blacklist;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public UpdateUserHandler(
        IUserRepository users,
        IUserRoleRepository userRoles,
        IRoleRepository roles,
        IPermissionProvider permissions,
        IRefreshTokenRepository refreshTokens,
        ITokenBlacklist blacklist,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _users = users;
        _userRoles = userRoles;
        _roles = roles;
        _permissions = permissions;
        _refreshTokens = refreshTokens;
        _blacklist = blacklist;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<UserDetailDto> Handle(UpdateUserCommand request, CancellationToken cancellationToken)
    {
        var user = await _users.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("用户不存在。");

        var now = _clock.UtcNow;
        user.ChangeProfile(request.DisplayName, request.Email, request.Phone, now, _currentUser.UserId);

        if (request.Status == "disabled" && user.Status != UserStatus.Disabled)
        {
            user.Disable(request.DisableReason ?? "管理员禁用", now, _currentUser.UserId);

            // 禁用即刻生效：吊销刷新令牌，并把已签发的访问令牌一并作废。
            await _refreshTokens.RevokeAllForUserAsync(
                request.Id, RefreshTokenRevokeReason.UserDisabled, now, cancellationToken);
            await _blacklist.RevokeUserAsync(request.Id, now, cancellationToken);
        }
        else if (request.Status == "active" && user.Status == UserStatus.Disabled)
        {
            user.Enable(now, _currentUser.UserId);
        }

        _users.Update(user);

        await _audit.RecordAsync(
            "user.update",
            "user",
            user.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["displayName"] = user.DisplayName,
                ["status"] = user.Status.ToStorage(),
            },
            cancellationToken);

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
                user.Status.ToStorage(),
                user.MustChangePassword,
                roleCodes,
                user.CreatedAt,
                user.LastLoginAt),
            roleIds,
            permissions.ToList());
    }
}

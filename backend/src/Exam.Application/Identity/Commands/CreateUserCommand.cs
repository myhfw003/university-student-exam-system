using Exam.Application.Common.Attributes;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Common.Security;
using Exam.Application.Identity.Contracts;
using Exam.Application.Settings.Services;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Identity.Commands;

/// <summary>新建用户。账号不限定为学号，在校学生与社会人士共用此入口。</summary>
public sealed record CreateUserCommand(
    string Username,
    string DisplayName,
    string? Password,
    string? Email,
    string? Phone,
    IReadOnlyList<long> RoleIds) : IAppCommand<UserDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.UserWrite];
}

public sealed class CreateUserCommandValidator : AbstractValidator<CreateUserCommand>
{
    public CreateUserCommandValidator()
    {
        RuleFor(x => x.Username)
            .NotEmpty().WithMessage("请填写账号。")
            .Must(UsernamePolicy.IsValid)
            .WithMessage($"账号需为 {UsernamePolicy.MinLength} 到 {UsernamePolicy.MaxLength} 位，且只含字母、数字、下划线、点和中划线。");

        RuleFor(x => x.DisplayName)
            .NotEmpty().WithMessage("请填写姓名。")
            .MaximumLength(64).WithMessage("姓名长度不能超过 64 位。");

        RuleFor(x => x.Email)
            .MaximumLength(256).WithMessage("邮箱长度不能超过 256 位。");

        RuleFor(x => x.Phone)
            .MaximumLength(32).WithMessage("手机号长度不能超过 32 位。");
    }
}

public sealed class CreateUserHandler : IRequestHandler<CreateUserCommand, UserDetailDto>
{
    private readonly IUserRepository _users;
    private readonly IUserRoleRepository _userRoles;
    private readonly IRoleRepository _roles;
    private readonly IPermissionProvider _permissions;
    private readonly IPasswordVerifier _passwordVerifier;
    private readonly SystemSettingsResolver _settings;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public CreateUserHandler(
        IUserRepository users,
        IUserRoleRepository userRoles,
        IRoleRepository roles,
        IPermissionProvider permissions,
        IPasswordVerifier passwordVerifier,
        SystemSettingsResolver settings,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _users = users;
        _userRoles = userRoles;
        _roles = roles;
        _permissions = permissions;
        _passwordVerifier = passwordVerifier;
        _settings = settings;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<UserDetailDto> Handle(CreateUserCommand request, CancellationToken cancellationToken)
    {
        var username = UsernamePolicy.Normalize(request.Username);

        if (await _users.GetByUsernameAsync(username, cancellationToken) is not null)
        {
            throw new DuplicateCodeException($"账号「{username}」已被占用。");
        }

        // 密码有两个来源：管理员明文给的，或**系统设定的原始密码**。
        // 没有它就别建号——凭空生成的密码谁也拿不到，账号建出来也是空壳。
        var password = request.Password;
        string passwordHash;
        var usedOriginalPassword = false;

        if (string.IsNullOrWhiteSpace(password))
        {
            var originalHash = await _settings.GetOriginalPasswordHashAsync(cancellationToken)
                ?? throw new OriginalPasswordNotConfiguredException(
                    "尚未配置原始密码，无法建账号。请先在「系统设置」中配置原始密码。");

            passwordHash = originalHash;
            usedOriginalPassword = true;
        }
        else
        {
            var failures = PasswordPolicy.Validate(password, username);
            if (failures.Count > 0)
            {
                throw new BusinessRuleException("密码不符合要求。", new Dictionary<string, string[]>(StringComparer.Ordinal)
                {
                    ["password"] = failures.ToArray(),
                });
            }

            passwordHash = _passwordVerifier.Hash(password);
        }

        var now = _clock.UtcNow;
        var user = User.Register(
            username,
            request.DisplayName,
            passwordHash,
            now,
            _currentUser.UserId);

        user.ChangeProfile(request.DisplayName, request.Email, request.Phone, now, _currentUser.UserId);

        if (usedOriginalPassword)
        {
            user.MarkMustChangePassword(now, _currentUser.UserId);
        }

        await _users.AddAsync(user, cancellationToken);

        // 主键由数据库生成，角色关联需要它，因此先落库。
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        var roleIds = await ResolveRolesAsync(request.RoleIds, cancellationToken);
        foreach (var roleId in roleIds)
        {
            await _userRoles.AddAsync(UserRole.Create(user.Id, roleId, _currentUser.UserId, now), cancellationToken);
        }

        await _audit.RecordAsync(
            "user.create",
            "user",
            user.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["username"] = user.Username,
                ["roleIds"] = roleIds,
                // 这里记的是**密码的来源**这个标记，不是密码本身。
                ["passwordSource"] = usedOriginalPassword ? "original" : "given",
            },
            cancellationToken);

        await _unitOfWork.SaveChangesAsync(cancellationToken);

        var permissions = await _permissions.GetPermissionsAsync(user.Id, cancellationToken);
        var roleCodes = await LoadRoleCodesAsync(roleIds, cancellationToken);

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
            roleIds,
            permissions.ToList());
    }

    private async Task<IReadOnlyList<long>> ResolveRolesAsync(
        IReadOnlyList<long> roleIds,
        CancellationToken cancellationToken)
    {
        var resolved = new List<long>();
        foreach (var roleId in roleIds.Distinct())
        {
            var role = await _roles.GetByIdAsync(roleId, cancellationToken);
            if (role is null)
            {
                throw new BusinessRuleException($"角色不存在：{roleId}。");
            }

            resolved.Add(roleId);
        }

        return resolved;
    }

    private async Task<IReadOnlyList<string>> LoadRoleCodesAsync(
        IReadOnlyList<long> roleIds,
        CancellationToken cancellationToken)
    {
        var codes = new List<string>();
        foreach (var roleId in roleIds)
        {
            var role = await _roles.GetByIdAsync(roleId, cancellationToken);
            if (role is not null)
            {
                codes.Add(role.Code);
            }
        }

        return codes;
    }
}

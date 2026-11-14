using Exam.Application.Common.Attributes;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Identity.Contracts;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Identity.Commands;

/// <summary>新建自定义角色。</summary>
public sealed record CreateRoleCommand(
    string Code,
    string Name,
    string? Description,
    IReadOnlyList<string> PermissionCodes) : IAppCommand<RoleDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.RoleWrite];
}

public sealed class CreateRoleCommandValidator : AbstractValidator<CreateRoleCommand>
{
    public CreateRoleCommandValidator()
    {
        RuleFor(x => x.Code)
            .NotEmpty().WithMessage("请填写角色编码。")
            .MaximumLength(64).WithMessage("角色编码长度不能超过 64 位。")
            .Matches("^[a-z][a-z0-9_]*$").WithMessage("角色编码只能包含小写字母、数字与下划线，且以字母开头。");

        RuleFor(x => x.Name)
            .NotEmpty().WithMessage("请填写角色名称。")
            .MaximumLength(64).WithMessage("角色名称长度不能超过 64 位。");
    }
}

public sealed class CreateRoleHandler : IRequestHandler<CreateRoleCommand, RoleDto>
{
    private readonly IRoleRepository _roles;
    private readonly IPermissionRepository _permissions;
    private readonly IRolePermissionRepository _rolePermissions;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public CreateRoleHandler(
        IRoleRepository roles,
        IPermissionRepository permissions,
        IRolePermissionRepository rolePermissions,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _roles = roles;
        _permissions = permissions;
        _rolePermissions = rolePermissions;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<RoleDto> Handle(CreateRoleCommand request, CancellationToken cancellationToken)
    {
        var code = request.Code.Trim();
        if (await _roles.GetByCodeAsync(code, cancellationToken) is not null)
        {
            throw new DuplicateCodeException($"角色编码「{code}」已存在。");
        }

        var permissions = await ResolvePermissionsAsync(request.PermissionCodes, cancellationToken);
        var now = _clock.UtcNow;

        var role = Role.Create(code, request.Name, now, _currentUser.UserId, request.Description);
        await _roles.AddAsync(role, cancellationToken);

        // 主键由数据库生成，角色权限关联需要它。
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        foreach (var permission in permissions)
        {
            await _rolePermissions.AddAsync(
                RolePermission.Create(role.Id, permission.Id, now),
                cancellationToken);
        }

        await _audit.RecordAsync(
            "role.create",
            "role",
            role.Id.ToString(),
            new Dictionary<string, object?> { ["code"] = role.Code },
            cancellationToken);

        return new RoleDto(
            role.Id,
            role.Code,
            role.Name,
            role.Description,
            role.IsSystem,
            permissions.Select(p => p.Code).ToList());
    }

    private async Task<IReadOnlyList<Permission>> ResolvePermissionsAsync(
        IReadOnlyList<string> permissionCodes,
        CancellationToken cancellationToken)
    {
        var codes = permissionCodes.Distinct(StringComparer.Ordinal).ToList();
        var permissions = await _permissions.GetByCodesAsync(codes, cancellationToken);

        var found = permissions.Select(p => p.Code).ToHashSet(StringComparer.Ordinal);
        var missing = codes.Where(c => !found.Contains(c)).ToArray();
        if (missing.Length > 0)
        {
            throw new BusinessRuleException($"存在未知权限点：{string.Join("、", missing)}。");
        }

        return permissions;
    }
}

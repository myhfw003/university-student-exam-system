using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Exceptions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Identity.Commands;

/// <summary>撤销用户的某个角色。撤销在下一次请求即生效。</summary>
public sealed record RevokeUserRoleCommand(long UserId, long RoleId) : IAppCommand, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.RoleWrite];
}

public sealed class RevokeUserRoleCommandValidator : AbstractValidator<RevokeUserRoleCommand>
{
    public RevokeUserRoleCommandValidator()
    {
        RuleFor(x => x.UserId).GreaterThan(0).WithMessage("用户 ID 不合法。");
        RuleFor(x => x.RoleId).GreaterThan(0).WithMessage("角色 ID 不合法。");
    }
}

public sealed class RevokeUserRoleHandler : IRequestHandler<RevokeUserRoleCommand, Unit>
{
    private readonly IUserRoleRepository _userRoles;
    private readonly IPermissionProvider _permissions;
    private readonly IAuditRecorder _audit;

    public RevokeUserRoleHandler(
        IUserRoleRepository userRoles,
        IPermissionProvider permissions,
        IAuditRecorder audit)
    {
        _userRoles = userRoles;
        _permissions = permissions;
        _audit = audit;
    }

    public async Task<Unit> Handle(RevokeUserRoleCommand request, CancellationToken cancellationToken)
    {
        var links = await _userRoles.GetByUserAsync(request.UserId, cancellationToken);
        var link = links.FirstOrDefault(l => l.RoleId == request.RoleId);
        if (link is null)
        {
            throw new NotFoundException("该用户没有这个角色。");
        }

        _userRoles.Remove(link);
        await _permissions.InvalidateAsync(request.UserId, cancellationToken);

        await _audit.RecordAsync(
            "user.revoke-role",
            "user",
            request.UserId.ToString(),
            new Dictionary<string, object?> { ["roleId"] = request.RoleId },
            cancellationToken);

        return Unit.Value;
    }
}

using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Identity.Contracts;
using Exam.Application.Settings.Services;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Identity.Commands;

/// <summary>
/// 重置用户密码：置为**系统设定的原始密码**。
/// <para>
/// 响应里不带任何密码——原始密码是管理员自己在「系统设置」里配好的，
/// 由管理员另行告知用户，不需要经由这个接口传回去。
/// </para>
/// <para>重置后用户下次登录必须修改密码，旧令牌立即失效。</para>
/// </summary>
public sealed record ResetUserPasswordCommand(long Id)
    : IAppCommand<ResetPasswordResult>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.UserWrite];
}

public sealed class ResetUserPasswordCommandValidator : AbstractValidator<ResetUserPasswordCommand>
{
    public ResetUserPasswordCommandValidator()
    {
        RuleFor(x => x.Id).GreaterThan(0).WithMessage("用户 ID 不合法。");
    }
}

public sealed class ResetUserPasswordHandler : IRequestHandler<ResetUserPasswordCommand, ResetPasswordResult>
{
    private readonly IUserRepository _users;
    private readonly SystemSettingsResolver _settings;
    private readonly IRefreshTokenRepository _refreshTokens;
    private readonly ITokenBlacklist _blacklist;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public ResetUserPasswordHandler(
        IUserRepository users,
        SystemSettingsResolver settings,
        IRefreshTokenRepository refreshTokens,
        ITokenBlacklist blacklist,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _users = users;
        _settings = settings;
        _refreshTokens = refreshTokens;
        _blacklist = blacklist;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<ResetPasswordResult> Handle(
        ResetUserPasswordCommand request,
        CancellationToken cancellationToken)
    {
        var user = await _users.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("用户不存在。");

        // 重置的目标是系统设定的原始密码。没配置就没有可置成的值，
        // 这时拒绝——凭空生成一个谁都不知道的密码，管理员交付不出去。
        var originalPasswordHash = await _settings.GetOriginalPasswordHashAsync(cancellationToken);
        if (originalPasswordHash is null)
        {
            throw new OriginalPasswordNotConfiguredException(
                "尚未配置原始密码，无法重置密码。请先在「系统设置」中配置原始密码。");
        }

        var now = _clock.UtcNow;

        user.ResetPasswordToOriginal(originalPasswordHash, now, _currentUser.UserId);
        _users.Update(user);

        // 密码变了，旧令牌必须立刻失效。
        await _refreshTokens.RevokeAllForUserAsync(
            request.Id, RefreshTokenRevokeReason.PasswordChanged, now, cancellationToken);
        await _blacklist.RevokeUserAsync(request.Id, now, cancellationToken);

        await _audit.RecordAsync(
            "user.reset-password",
            "user",
            user.Id.ToString(),
            new Dictionary<string, object?> { ["username"] = user.Username },
            cancellationToken);

        return new ResetPasswordResult(user.Id);
    }
}

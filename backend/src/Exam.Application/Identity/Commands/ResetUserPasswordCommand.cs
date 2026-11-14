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

/// <summary>重置用户密码。重置后用户下次登录必须修改密码，旧令牌立即失效。</summary>
public sealed record ResetUserPasswordCommand(long Id, string? NewPassword)
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
    private readonly IPasswordVerifier _passwordVerifier;
    private readonly IRefreshTokenRepository _refreshTokens;
    private readonly ITokenBlacklist _blacklist;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public ResetUserPasswordHandler(
        IUserRepository users,
        IPasswordVerifier passwordVerifier,
        IRefreshTokenRepository refreshTokens,
        ITokenBlacklist blacklist,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _users = users;
        _passwordVerifier = passwordVerifier;
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

        var now = _clock.UtcNow;

        var password = request.NewPassword;
        var generated = false;
        if (string.IsNullOrWhiteSpace(password))
        {
            password = _passwordVerifier.GenerateInitialPassword() + "aA1";
            generated = true;
        }

        user.ResetPassword(password, _passwordVerifier, now, _currentUser.UserId);
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

        return new ResetPasswordResult(user.Id, generated ? password : null);
    }
}

using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Identity.Services;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Identity.Commands;

/// <summary>
/// 修改本人密码：必须校验原密码；改密后**保留当前会话**，
/// 吊销该用户其它全部刷新令牌族（07-security-compliance §改密）。
/// </summary>
public sealed record ChangeOwnPasswordCommand(
    string CurrentPassword,
    string NewPassword,
    string? CurrentRefreshToken = null) : IAppCommand<ChangePasswordResult>, IAuthorizableRequest, IExemptFromPasswordChange
{
    // 修改本人密码只要求已登录，不要求额外权限点。
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [];
}

/// <summary>改密结果。带上新的访问令牌，客户端不必等令牌过期。</summary>
public sealed record ChangePasswordResult(string AccessToken, string TokenType, int ExpiresIn);

public sealed class ChangeOwnPasswordCommandValidator : AbstractValidator<ChangeOwnPasswordCommand>
{
    public ChangeOwnPasswordCommandValidator()
    {
        RuleFor(x => x.CurrentPassword).NotEmpty().WithMessage("请输入当前密码。");
        RuleFor(x => x.NewPassword).NotEmpty().WithMessage("请输入新密码。");
    }
}

public sealed class ChangeOwnPasswordHandler : IRequestHandler<ChangeOwnPasswordCommand, ChangePasswordResult>
{
    private readonly IUserRepository _users;
    private readonly IPasswordVerifier _passwordVerifier;
    private readonly IRefreshTokenRepository _refreshTokens;
    private readonly ITokenService _tokenService;
    private readonly IUserPermissionService _permissions;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public ChangeOwnPasswordHandler(
        IUserRepository users,
        IPasswordVerifier passwordVerifier,
        IRefreshTokenRepository refreshTokens,
        ITokenService tokenService,
        IUserPermissionService permissions,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _users = users;
        _passwordVerifier = passwordVerifier;
        _refreshTokens = refreshTokens;
        _tokenService = tokenService;
        _permissions = permissions;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<ChangePasswordResult> Handle(
        ChangeOwnPasswordCommand request,
        CancellationToken cancellationToken)
    {
        var userId = _currentUser.UserId ?? throw new ForbiddenException("请先登录。");

        var user = await _users.GetByIdAsync(userId, cancellationToken)
            ?? throw new NotFoundException("用户不存在。");

        var now = _clock.UtcNow;
        user.ChangePassword(
            request.CurrentPassword,
            request.NewPassword,
            _passwordVerifier,
            now,
            userId);
        _users.Update(user);

        // 安全要求：改密吊销该用户其它设备上的令牌族，当前会话保留。
        Guid? currentFamily = null;
        if (!string.IsNullOrWhiteSpace(request.CurrentRefreshToken))
        {
            var hash = _tokenService.HashRefreshToken(request.CurrentRefreshToken);
            var stored = await _refreshTokens.GetByHashAsync(hash, cancellationToken);
            currentFamily = stored?.FamilyId;
        }

        var tokens = await _refreshTokens.GetByUserAsync(userId, cancellationToken);
        foreach (var token in tokens)
        {
            if (token.RevokedAt is not null) continue;
            if (currentFamily is { } family && token.FamilyId == family) continue;

            token.Revoke(RefreshTokenRevokeReason.PasswordChanged, now);
            _refreshTokens.Update(token);
        }

        await _audit.RecordAsync(
            "user.change-password",
            "user",
            user.Id.ToString(),
            new Dictionary<string, object?> { ["username"] = user.Username },
            cancellationToken);

        // 重新签发访问令牌：旧令牌上带着「必须改密」的标记，
        // 不换掉的话用户改完密还要等令牌过期才能继续用系统。
        var permissionCodes = await _permissions.GetPermissionCodesAsync(user.Id, cancellationToken);
        var access = _tokenService.IssueAccessToken(user.Id, user.Username, permissionCodes);

        return new ChangePasswordResult(
            access.Token,
            "Bearer",
            (int)Math.Max(0, (access.ExpiresAt - now).TotalSeconds));
    }
}

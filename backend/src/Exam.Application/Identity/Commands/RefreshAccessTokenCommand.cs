using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Identity.Contracts;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Identity.Commands;

/// <summary>
/// 刷新访问令牌。采用轮换 + 令牌族模型：
/// 每次刷新签发新令牌并吊销旧令牌；若已吊销的令牌被再次使用，判定为盗用并整族吊销。
/// </summary>
public sealed record RefreshAccessTokenCommand(string RawRefreshToken) : IAppCommand<RefreshAccessTokenResult>;

public sealed class RefreshAccessTokenCommandValidator : AbstractValidator<RefreshAccessTokenCommand>
{
    public RefreshAccessTokenCommandValidator() => RuleFor(x => x.RawRefreshToken).NotEmpty().WithMessage("缺少刷新令牌。");
}

public sealed class RefreshAccessTokenHandler : IRequestHandler<RefreshAccessTokenCommand, RefreshAccessTokenResult>
{
    private readonly IRefreshTokenRepository _refreshTokens;
    private readonly IUserRepository _users;
    private readonly IUserPermissionService _permissions;
    private readonly ITokenService _tokenService;
    private readonly IClock _clock;

    public RefreshAccessTokenHandler(
        IRefreshTokenRepository refreshTokens,
        IUserRepository users,
        IUserPermissionService permissions,
        ITokenService tokenService,
        IClock clock)
    {
        _refreshTokens = refreshTokens;
        _users = users;
        _permissions = permissions;
        _tokenService = tokenService;
        _clock = clock;
    }

    public async Task<RefreshAccessTokenResult> Handle(
        RefreshAccessTokenCommand request,
        CancellationToken cancellationToken)
    {
        var now = _clock.UtcNow;
        var hash = _tokenService.HashRefreshToken(request.RawRefreshToken);

        var stored = await _refreshTokens.GetByHashAsync(hash, cancellationToken);
        if (stored is null)
        {
            throw new BusinessRuleException("刷新令牌无效，请重新登录。");
        }

        if (stored.RevokedAt is not null)
        {
            // 复用检测：整族吊销，强制重新登录。
            var family = await _refreshTokens.GetFamilyAsync(stored.FamilyId, cancellationToken);
            foreach (var token in family.Where(t => t.RevokedAt is null))
            {
                token.Revoke(RefreshTokenRevokeReason.ReuseDetected, now);
                _refreshTokens.Update(token);
            }

            throw new BusinessRuleException("检测到刷新令牌异常使用，请重新登录。");
        }

        if (stored.IsExpired(now))
        {
            stored.Revoke(RefreshTokenRevokeReason.Expired, now);
            _refreshTokens.Update(stored);
            throw new BusinessRuleException("登录状态已过期，请重新登录。");
        }

        var user = await _users.GetByIdAsync(stored.UserId, cancellationToken);
        if (user is null || user.Status == UserStatus.Disabled)
        {
            stored.Revoke(RefreshTokenRevokeReason.UserDisabled, now);
            _refreshTokens.Update(stored);
            throw new BusinessRuleException("账号不可用，请重新登录。");
        }

        var permissionCodes = await _permissions.GetPermissionCodesAsync(user.Id, cancellationToken);
        var access = _tokenService.IssueAccessToken(
            user.Id,
            user.Username,
            permissionCodes,
            user.MustChangePassword);

        // 轮换：新令牌属于同一令牌族。
        var refresh = _tokenService.IssueRefreshToken(user.Id, stored.FamilyId);
        var newEntity = RefreshToken.Issue(user.Id, refresh.TokenHash, stored.FamilyId, refresh.ExpiresAt, now);
        await _refreshTokens.AddAsync(newEntity, cancellationToken);

        stored.Revoke(RefreshTokenRevokeReason.Rotated, now);
        _refreshTokens.Update(stored);

        return new RefreshAccessTokenResult(
            access.Token,
            "Bearer",
            (int)Math.Max(0, (access.ExpiresAt - now).TotalSeconds),
            refresh.RawToken,
            refresh.ExpiresAt);
    }
}

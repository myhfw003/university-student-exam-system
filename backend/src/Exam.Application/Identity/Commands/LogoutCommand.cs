using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using MediatR;

namespace Exam.Application.Identity.Commands;

/// <summary>登出：吊销当前令牌族，并把当前访问令牌加入吊销名单。</summary>
public sealed record LogoutCommand(string? RawRefreshToken, string? AccessTokenJti)
    : IAppCommand, IAuthorizableRequest, IExemptFromPasswordChange
{
    public IReadOnlyCollection<string> RequiredPermissions { get; } = [];
}

public sealed class LogoutHandler : IRequestHandler<LogoutCommand, Unit>
{
    private readonly IRefreshTokenRepository _refreshTokens;
    private readonly ITokenBlacklist _blacklist;
    private readonly ITokenService _tokenService;
    private readonly IClock _clock;
    private readonly IAuditRecorder _audit;
    private readonly ICurrentUser _currentUser;

    public LogoutHandler(
        IRefreshTokenRepository refreshTokens,
        ITokenBlacklist blacklist,
        ITokenService tokenService,
        IClock clock,
        IAuditRecorder audit,
        ICurrentUser currentUser)
    {
        _refreshTokens = refreshTokens;
        _blacklist = blacklist;
        _tokenService = tokenService;
        _clock = clock;
        _audit = audit;
        _currentUser = currentUser;
    }

    public async Task<Unit> Handle(LogoutCommand request, CancellationToken cancellationToken)
    {
        var now = _clock.UtcNow;

        var revokedRefreshToken = false;

        if (!string.IsNullOrWhiteSpace(request.RawRefreshToken))
        {
            var hash = _tokenService.HashRefreshToken(request.RawRefreshToken);
            var stored = await _refreshTokens.GetByHashAsync(hash, cancellationToken);
            if (stored is not null)
            {
                foreach (var token in await _refreshTokens.GetFamilyAsync(stored.FamilyId, cancellationToken))
                {
                    if (token.RevokedAt is null)
                    {
                        token.Revoke(RefreshTokenRevokeReason.Logout, now);
                        _refreshTokens.Update(token);
                    }
                }

                revokedRefreshToken = true;
            }
        }

        if (!string.IsNullOrWhiteSpace(request.AccessTokenJti))
        {
            await _blacklist.RevokeAsync(request.AccessTokenJti, now.AddMinutes(30), cancellationToken);
        }

        // 登出也要留痕（安全合规文档 §8.2 的必审计动作清单里列着「登出」）。
        await _audit.RecordAsync(
            "auth.logout",
            "user",
            _currentUser.UserId?.ToString(),
            new Dictionary<string, object?>
            {
                ["username"] = _currentUser.Username,
                ["refreshTokenRevoked"] = revokedRefreshToken,
            },
            cancellationToken);

        return Unit.Value;
    }
}

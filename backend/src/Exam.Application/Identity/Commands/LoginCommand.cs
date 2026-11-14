using Exam.Application.Common.Attributes;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Identity.Contracts;
using Exam.Application.Identity.Services;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Identity.Commands;

/// <summary>账号密码登录。账号不限定为学号，在校学生与社会人士使用同一入口。</summary>
public sealed record LoginCommand(string Username, string Password) : IAppCommand<LoginResult>
{
    public const string RefreshCookieName = "rt";
}

public sealed class LoginCommandValidator : AbstractValidator<LoginCommand>
{
    public LoginCommandValidator()
    {
        RuleFor(x => x.Username)
            .NotEmpty().WithMessage("请输入账号。")
            .MaximumLength(UsernamePolicy.MaxLength).WithMessage($"账号长度不能超过 {UsernamePolicy.MaxLength} 位。");

        RuleFor(x => x.Password)
            .NotEmpty().WithMessage("请输入密码。");
    }
}

public sealed class LoginHandler : IRequestHandler<LoginCommand, LoginResult>
{
    private readonly IUserRepository _users;
    private readonly IRefreshTokenRepository _refreshTokens;
    private readonly IUserPermissionService _permissions;
    private readonly ITokenService _tokenService;
    private readonly IPasswordVerifier _passwordVerifier;
    private readonly IClock _clock;
    private readonly IRequestContext _requestContext;
    private readonly UserOrganizationResolver _organization;

    public LoginHandler(
        IUserRepository users,
        IRefreshTokenRepository refreshTokens,
        IUserPermissionService permissions,
        ITokenService tokenService,
        IPasswordVerifier passwordVerifier,
        IClock clock,
        IRequestContext requestContext,
        UserOrganizationResolver organization)
    {
        _organization = organization;
        _users = users;
        _refreshTokens = refreshTokens;
        _permissions = permissions;
        _tokenService = tokenService;
        _passwordVerifier = passwordVerifier;
        _clock = clock;
        _requestContext = requestContext;
    }

    public async Task<LoginResult> Handle(LoginCommand request, CancellationToken cancellationToken)
    {
        var now = _clock.UtcNow;
        var username = UsernamePolicy.Normalize(request.Username ?? string.Empty);

        var user = await _users.GetByUsernameAsync(username, cancellationToken);
        if (user is null)
        {
            // 与密码错误使用同一提示，避免账号枚举。
            throw new BusinessRuleException("账号或密码错误。");
        }

        user.Authenticate(request.Password ?? string.Empty, _passwordVerifier, now);

        var permissionCodes = await _permissions.GetPermissionCodesAsync(user.Id, cancellationToken);
        var roleCodes = await _permissions.GetRoleCodesAsync(user.Id, cancellationToken);

        var access = _tokenService.IssueAccessToken(user.Id, user.Username, permissionCodes);

        var familyId = Guid.NewGuid();
        var refresh = _tokenService.IssueRefreshToken(user.Id, familyId);
        var refreshEntity = RefreshToken.Issue(
            user.Id,
            refresh.TokenHash,
            familyId,
            refresh.ExpiresAt,
            now,
            _requestContext.IpAddress,
            _requestContext.UserAgent);

        await _refreshTokens.AddAsync(refreshEntity, cancellationToken);

        var organization = await _organization.ResolveAsync(user.Id, cancellationToken);

        var profile = new UserProfileDto(
            user.Id,
            user.Username,
            user.DisplayName,
            roleCodes.ToList(),
            permissionCodes.ToList(),
            organization.Tags.Select(t => new OrganizationTagDto(t.Id, t.Name)).ToList(),
            user.MustChangePassword);

        return new LoginResult(
            access.Token,
            "Bearer",
            (int)Math.Max(0, (access.ExpiresAt - now).TotalSeconds),
            profile,
            refresh.RawToken,
            refresh.ExpiresAt);
    }
}

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
    private readonly IAuditRecorder _audit;
    private readonly IUnitOfWork _unitOfWork;

    public LoginHandler(
        IUserRepository users,
        IRefreshTokenRepository refreshTokens,
        IUserPermissionService permissions,
        ITokenService tokenService,
        IPasswordVerifier passwordVerifier,
        IClock clock,
        IRequestContext requestContext,
        UserOrganizationResolver organization,
        IAuditRecorder audit,
        IUnitOfWork unitOfWork)
    {
        _organization = organization;
        _users = users;
        _refreshTokens = refreshTokens;
        _permissions = permissions;
        _tokenService = tokenService;
        _passwordVerifier = passwordVerifier;
        _clock = clock;
        _requestContext = requestContext;
        _audit = audit;
        _unitOfWork = unitOfWork;
    }

    public async Task<LoginResult> Handle(LoginCommand request, CancellationToken cancellationToken)
    {
        var now = _clock.UtcNow;
        var username = UsernamePolicy.Normalize(request.Username ?? string.Empty);

        var user = await _users.GetByUsernameAsync(username, cancellationToken);
        if (user is null)
        {
            // 账号不存在也要留痕：审计是发现撞库的主要依据。
            await RecordLoginFailureAsync(username, null, username, "账号不存在", cancellationToken);

            // 与密码错误使用同一提示，避免账号枚举。
            throw new BusinessRuleException("账号或密码错误。");
        }

        // 失败原因要在 Authenticate 之前判定：它会把账号锁上，事后再看状态就分不清是密码错还是被锁。
        var failureReason = user.Status switch
        {
            UserStatus.Disabled => "账号已禁用",
            UserStatus.Locked when user.IsLocked(now) => "账号已锁定",
            _ => "密码错误",
        };

        try
        {
            user.Authenticate(request.Password ?? string.Empty, _passwordVerifier, now);
        }
        catch (BusinessRuleException)
        {
            await RecordLoginFailureAsync(username, user.Id, user.Username, failureReason, cancellationToken);
            throw;
        }

        // 登录成功留痕。此刻还没有令牌，操作者取不到当前用户，只能给本人。
        await _audit.RecordAsAsync(
            user.Id,
            user.Username,
            "auth.login",
            "user",
            user.Id.ToString(),
            new Dictionary<string, object?> { ["username"] = user.Username },
            cancellationToken);

        var permissionCodes = await _permissions.GetPermissionCodesAsync(user.Id, cancellationToken);
        var roleCodes = await _permissions.GetRoleCodesAsync(user.Id, cancellationToken);

        var access = _tokenService.IssueAccessToken(
            user.Id,
            user.Username,
            permissionCodes,
            user.MustChangePassword);

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

    /// <summary>
    /// 记一次登录失败，并把这次失败落库。
    /// <para>
    /// 失败路径会抛异常，工作单元只在命令成功返回后才提交，
    /// 审计行与失败计数都跟着异常回滚的话，「登录失败」这件事根本查不到，
    /// 账号也永远锁不住。所以这里单独提交一次。
    /// </para>
    /// </summary>
    private async Task RecordLoginFailureAsync(
        string username,
        long? operatorId,
        string? operatorName,
        string reason,
        CancellationToken cancellationToken)
    {
        await _audit.RecordAsAsync(
            operatorId,
            operatorName,
            "auth.login_failed",
            "user",
            operatorId?.ToString() ?? username,
            new Dictionary<string, object?>
            {
                ["username"] = username,
                ["reason"] = reason,
            },
            cancellationToken);

        await _unitOfWork.SaveChangesAsync(cancellationToken);
    }
}

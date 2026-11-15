using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Exam.Application.Common.Exceptions;
using Exam.Application.Identity.Commands;
using Exam.Application.Identity.Contracts;
using Exam.Application.Identity.Queries;
using Exam.Domain.SharedKernel.Exceptions;
using Exam.Web.Api.Contracts;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Controllers;

/// <summary>认证：登录、刷新、登出与当前用户。</summary>
[ApiController]
[Route("api/v1/auth")]
public sealed class AuthController : ControllerBase
{
    private const string RefreshCookieName = LoginCommand.RefreshCookieName;

    private readonly IMediator _mediator;
    private readonly IHostEnvironment _environment;

    public AuthController(IMediator mediator, IHostEnvironment environment)
    {
        _mediator = mediator;
        _environment = environment;
    }

    /// <summary>登录。返回访问令牌与当前用户档案（含权限码）。</summary>
    [HttpPost("login")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(LoginResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<LoginResponse> Login(LoginRequest request, CancellationToken cancellationToken)
    {
        var result = await _mediator.Send(
            new LoginCommand(request.Username ?? string.Empty, request.Password ?? string.Empty),
            cancellationToken);

        SetRefreshCookie(result.RefreshToken, result.RefreshTokenExpiresAt);

        return new LoginResponse(result.AccessToken, result.TokenType, result.ExpiresIn, result.User);
    }

    /// <summary>刷新访问令牌。刷新令牌一次性：用过即失效，重复使用按盗用处理。</summary>
    [HttpPost("refresh")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(RefreshResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<RefreshResponse> Refresh(CancellationToken cancellationToken)
    {
        var raw = Request.Cookies[RefreshCookieName];
        if (string.IsNullOrWhiteSpace(raw))
        {
            throw new BusinessRuleException("登录状态已过期，请重新登录。");
        }

        var result = await _mediator.Send(new RefreshAccessTokenCommand(raw), cancellationToken);

        SetRefreshCookie(result.RefreshToken, result.RefreshTokenExpiresAt);

        return new RefreshResponse(result.AccessToken, result.TokenType, result.ExpiresIn);
    }

    /// <summary>登出。吊销当前刷新令牌，令牌立即失效。</summary>
    [HttpPost("logout")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Logout(CancellationToken cancellationToken)
    {
        var raw = Request.Cookies[RefreshCookieName];
        var jti = User.FindFirstValue(JwtRegisteredClaimNames.Jti);

        await _mediator.Send(new LogoutCommand(raw, jti), cancellationToken);

        Response.Cookies.Delete(RefreshCookieName, new CookieOptions { Path = "/api/v1/auth" });
        return NoContent();
    }

    /// <summary>当前用户档案与权限码。前端据此显示入口，后端仍会独立校验权限。</summary>
    [HttpGet("me")]
    [Authorize]
    [ProducesResponseType(typeof(UserProfileDto), StatusCodes.Status200OK)]
    public async Task<UserProfileDto?> Me(CancellationToken cancellationToken) =>
        await _mediator.Send(new GetCurrentUserQuery(), cancellationToken);

    private void SetRefreshCookie(string token, DateTimeOffset expiresAt) =>
        Response.Cookies.Append(RefreshCookieName, token, new CookieOptions
        {
            HttpOnly = true,
            Secure = !_environment.IsDevelopment(),
            SameSite = SameSiteMode.Strict,
            Expires = expiresAt,
            Path = "/api/v1/auth",
        });
}

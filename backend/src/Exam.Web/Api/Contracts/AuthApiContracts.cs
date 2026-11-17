using Exam.Application.Identity.Contracts;

namespace Exam.Web.Api.Contracts;

public sealed record LoginRequest(string Username, string Password);

public sealed record LoginResponse(string AccessToken, string TokenType, int ExpiresIn, UserProfileDto User);

public sealed record RefreshResponse(string AccessToken, string TokenType, int ExpiresIn);

/// <summary>修改本人密码。</summary>
public sealed record ChangePasswordRequest(string? CurrentPassword, string? NewPassword);

/// <summary>改密结果：带新的访问令牌，客户端立即换掉带「必须改密」标记的旧令牌。</summary>
public sealed record ChangePasswordResponse(string AccessToken, string TokenType, int ExpiresIn);

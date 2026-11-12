using Exam.Application.Identity.Contracts;

namespace Exam.Web.Api.Contracts;

public sealed record LoginRequest(string Username, string Password);

public sealed record LoginResponse(string AccessToken, string TokenType, int ExpiresIn, UserProfileDto User);

public sealed record RefreshResponse(string AccessToken, string TokenType, int ExpiresIn);

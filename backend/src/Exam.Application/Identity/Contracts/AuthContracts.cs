namespace Exam.Application.Identity.Contracts;

/// <summary>用户在组织维度下的归属标签。社会人士没有该归属。</summary>
public sealed record OrganizationTagDto(long Id, string Name);

/// <summary>用户档案。</summary>
public sealed record UserProfileDto(
    long Id,
    string Username,
    string DisplayName,
    IReadOnlyList<string> Roles,
    IReadOnlyList<string> Permissions,
    IReadOnlyList<OrganizationTagDto> OrganizationTags,
    bool MustChangePassword);

/// <summary>登录结果。RefreshToken 由 Web 层写入 HttpOnly Cookie，不出现在响应体中。</summary>
public sealed record LoginResult(
    string AccessToken,
    string TokenType,
    int ExpiresIn,
    UserProfileDto User,
    string RefreshToken,
    DateTimeOffset RefreshTokenExpiresAt);

/// <summary>刷新结果。</summary>
public sealed record RefreshAccessTokenResult(
    string AccessToken,
    string TokenType,
    int ExpiresIn,
    string RefreshToken,
    DateTimeOffset RefreshTokenExpiresAt);

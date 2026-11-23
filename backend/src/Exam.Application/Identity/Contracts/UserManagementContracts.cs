namespace Exam.Application.Identity.Contracts;

/// <summary>用户列表项。</summary>
public sealed record UserSummaryDto(
    long Id,
    string Username,
    string DisplayName,
    string? Email,
    string? Phone,
    string Status,
    bool MustChangePassword,
    IReadOnlyList<string> Roles,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastLoginAt);

/// <summary>用户详情：档案 + 角色 + 权限。</summary>
public sealed record UserDetailDto(
    UserSummaryDto User,
    IReadOnlyList<long> RoleIds,
    IReadOnlyList<string> Permissions);

/// <summary>
/// 用户的组织归属摘要。
/// <para>与用户条目平行返回：管理端列表要展示每个人的组织标签与完整路径。</para>
/// </summary>
public sealed record UserOrganizationSummaryDto(
    long UserId,
    IReadOnlyList<long> TagIds,
    string? OrganizationPath);

/// <summary>分页的用户列表。</summary>
public sealed record UserListResponse(
    IReadOnlyList<UserSummaryDto> Items,
    int Total,
    int Page,
    int Size,
    IReadOnlyList<UserOrganizationSummaryDto> Organizations);

/// <summary>角色视图。</summary>
public sealed record RoleDto(
    long Id,
    string Code,
    string Name,
    string? Description,
    bool IsSystem,
    IReadOnlyList<string> Permissions);

/// <summary>权限点视图。</summary>
public sealed record PermissionDto(
    string Code,
    string Name,
    string Module,
    string? Description);

/// <summary>
/// 密码重置结果。
/// <para>
/// **不带任何密码**：重置后的密码是系统设定的原始密码，
/// 管理员自己知道（它在「系统设置」里配置的），不需要经由接口传回去。
/// </para>
/// </summary>
public sealed record ResetPasswordResult(long UserId);

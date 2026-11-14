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

/// <summary>分页的用户列表。</summary>
public sealed record UserListResponse(
    IReadOnlyList<UserSummaryDto> Items,
    int Total,
    int Page,
    int Size);

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

/// <summary>密码重置结果。生成初始密码时把明文返回给管理员，其余情况为空。</summary>
public sealed record ResetPasswordResult(long UserId, string? InitialPassword);

namespace Exam.Web.Api.Contracts;

public sealed record CreateUserRequest(
    string Username,
    string DisplayName,
    string? Password,
    string? Email,
    string? Phone,
    IReadOnlyList<long>? RoleIds);

public sealed record UpdateUserRequest(
    string DisplayName,
    string? Email,
    string? Phone,
    string? Status,
    string? DisableReason);

public sealed record AssignRolesRequest(IReadOnlyList<long> RoleIds);

public sealed record AssignTagsRequest(IReadOnlyList<long> TagIds);

public sealed record CreateRoleRequest(
    string Code,
    string Name,
    string? Description,
    IReadOnlyList<string>? PermissionCodes);

public sealed record UpdateRoleRequest(
    string Name,
    string? Description,
    IReadOnlyList<string>? PermissionCodes);

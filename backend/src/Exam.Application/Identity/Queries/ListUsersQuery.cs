using Exam.Application.Common.Attributes;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Common.Security;
using Exam.Application.Identity.Contracts;
using Exam.Application.Identity.Services;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Exceptions;
using MediatR;

namespace Exam.Application.Identity.Queries;

/// <summary>分页查询用户。支持关键词、状态与角色过滤。</summary>
public sealed record ListUsersQuery(
    string? Keyword,
    string? Status,
    long? RoleId,
    int Page,
    int Size) : IAppQuery<UserListResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.UserRead];
}

public sealed class ListUsersHandler : IRequestHandler<ListUsersQuery, UserListResponse>
{
    private readonly IUserRepository _users;
    private readonly IUserRoleRepository _userRoles;
    private readonly IRoleRepository _roles;
    private readonly UserOrganizationResolver _organization;

    public ListUsersHandler(
        IUserRepository users,
        IUserRoleRepository userRoles,
        IRoleRepository roles,
        UserOrganizationResolver organization)
    {
        _users = users;
        _userRoles = userRoles;
        _roles = roles;
        _organization = organization;
    }

    public async Task<UserListResponse> Handle(ListUsersQuery request, CancellationToken cancellationToken)
    {
        var status = ParseStatus(request.Status);
        var page = Math.Max(1, request.Page);
        var size = Math.Clamp(request.Size, 1, 200);

        var total = await _users.CountAsync(request.Keyword, status, request.RoleId, cancellationToken);
        var users = await _users.SearchAsync(
            request.Keyword, status, request.RoleId, (page - 1) * size, size, cancellationToken);

        var items = new List<UserSummaryDto>(users.Count);
        foreach (var user in users)
        {
            items.Add(await ToSummaryAsync(user, cancellationToken));
        }

        // 组织归属一次批量推导：列表要展示每个人的组织标签与完整路径。
        var organizations = await _organization.ResolveManyAsync(
            users.Select(u => u.Id).ToList(),
            cancellationToken);

        return new UserListResponse(
            items,
            total,
            page,
            size,
            organizations.Values
                .Select(o => new UserOrganizationSummaryDto(
                    o.UserId,
                    o.Tags.Select(t => t.Id).ToList(),
                    o.OrganizationPath))
                .ToList());
    }

    internal static UserStatus? ParseStatus(string? status)
    {
        if (string.IsNullOrWhiteSpace(status))
        {
            return null;
        }

        return status.ToLowerInvariant() switch
        {
            "active" => UserStatus.Active,
            "locked" => UserStatus.Locked,
            "disabled" => UserStatus.Disabled,
            _ => throw new BusinessRuleException("用户状态取值不合法。"),
        };
    }

    internal async Task<UserSummaryDto> ToSummaryAsync(User user, CancellationToken cancellationToken)
    {
        var roleIds = await _userRoles.GetRoleIdsAsync(user.Id, cancellationToken);
        var roleCodes = new List<string>(roleIds.Count);
        foreach (var roleId in roleIds)
        {
            var role = await _roles.GetByIdAsync(roleId, cancellationToken);
            if (role is not null)
            {
                roleCodes.Add(role.Code);
            }
        }

        return new UserSummaryDto(
            user.Id,
            user.Username,
            user.DisplayName,
            user.Email,
            SensitiveDataMasker.MaskPhone(user.Phone),
            user.Status.ToStorage(),
            user.MustChangePassword,
            roleCodes,
            user.CreatedAt,
            user.LastLoginAt);
    }
}

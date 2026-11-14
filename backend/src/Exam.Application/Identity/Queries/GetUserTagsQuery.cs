using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Identity.Contracts;
using Exam.Application.Identity.Services;
using Exam.Domain.Identity;
using MediatR;

namespace Exam.Application.Identity.Queries;

/// <summary>取回用户挂载的组织标签与推导出的完整组织路径。</summary>
public sealed record GetUserTagsQuery(long UserId) : IAppQuery<UserTagsResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [];
}

public sealed class GetUserTagsHandler : IRequestHandler<GetUserTagsQuery, UserTagsResponse>
{
    private readonly IUserRepository _users;
    private readonly UserOrganizationResolver _organization;
    private readonly IPermissionProvider _permissions;
    private readonly ICurrentUser _currentUser;

    public GetUserTagsHandler(
        IUserRepository users,
        UserOrganizationResolver organization,
        IPermissionProvider permissions,
        ICurrentUser currentUser)
    {
        _users = users;
        _organization = organization;
        _permissions = permissions;
        _currentUser = currentUser;
    }

    public async Task<UserTagsResponse> Handle(GetUserTagsQuery request, CancellationToken cancellationToken)
    {
        var isSelf = _currentUser.UserId == request.UserId;
        if (!isSelf)
        {
            var granted = await _permissions.GetPermissionsAsync(
                _currentUser.UserId ?? 0, cancellationToken);
            if (!granted.Contains(PermissionCatalog.UserRead))
            {
                throw new ForbiddenException("没有查看该用户组织归属的权限。");
            }
        }

        var user = await _users.GetByIdAsync(request.UserId, cancellationToken)
            ?? throw new NotFoundException("用户不存在。");

        return await _organization.ResolveAsync(user.Id, cancellationToken);
    }
}

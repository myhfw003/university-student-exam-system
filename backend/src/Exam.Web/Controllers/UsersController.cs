using Exam.Application.Identity.Commands;
using Exam.Application.Identity.Contracts;
using Exam.Application.Identity.Queries;
using Exam.Domain.Identity;
using Exam.Web.Api.Contracts;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Controllers;

/// <summary>用户管理。账号不限定为学号，在校学生与社会人士共用一套接口。</summary>
[ApiController]
[Route("api/v1/users")]
[Authorize]
public sealed class UsersController : ControllerBase
{
    private readonly IMediator _mediator;

    public UsersController(IMediator mediator) => _mediator = mediator;

    /// <summary>分页查询用户。支持关键词、状态与角色过滤。</summary>
    [HttpGet]
    [Authorize(Policy = PermissionCatalog.UserRead)]
    [ProducesResponseType(typeof(UserListResponse), StatusCodes.Status200OK)]
    public async Task<UserListResponse> List(
        [FromQuery] string? keyword,
        [FromQuery] string? status,
        [FromQuery] long? roleId,
        [FromQuery] int page = 1,
        [FromQuery] int size = 20,
        CancellationToken cancellationToken = default) =>
        await _mediator.Send(
            new ListUsersQuery(keyword, status, roleId, page, size),
            cancellationToken);

    /// <summary>新建用户。未指定密码时生成随机初始密码并要求首次登录修改。</summary>
    [HttpPost]
    [Authorize(Policy = PermissionCatalog.UserWrite)]
    [ProducesResponseType(typeof(UserDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<UserDetailDto> Create(CreateUserRequest request, CancellationToken cancellationToken) =>
        await _mediator.Send(
            new CreateUserCommand(
                request.Username,
                request.DisplayName,
                request.Password,
                request.Email,
                request.Phone,
                request.RoleIds ?? []),
            cancellationToken);

    /// <summary>取回用户详情。本人可读自己的档案。</summary>
    [HttpGet("{id:long}")]
    [ProducesResponseType(typeof(UserDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<UserDetailDto> Get(long id, CancellationToken cancellationToken) =>
        await _mediator.Send(new GetUserQuery(id), cancellationToken);

    /// <summary>修改用户档案与状态。禁用会立即吊销该用户的全部令牌。</summary>
    [HttpPut("{id:long}")]
    [Authorize(Policy = PermissionCatalog.UserWrite)]
    [ProducesResponseType(typeof(UserDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<UserDetailDto> Update(
        long id,
        UpdateUserRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new UpdateUserCommand(
                id,
                request.DisplayName,
                request.Email,
                request.Phone,
                request.Status,
                request.DisableReason),
            cancellationToken);

    /// <summary>重置用户密码。未指定新密码时返回随机初始密码。</summary>
    [HttpPost("{id:long}/reset-password")]
    [Authorize(Policy = PermissionCatalog.UserWrite)]
    [ProducesResponseType(typeof(ResetPasswordResult), StatusCodes.Status200OK)]
    public async Task<ResetPasswordResult> ResetPassword(
        long id,
        [FromBody] ResetPasswordRequest? request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new ResetUserPasswordCommand(id, request?.NewPassword),
            cancellationToken);

    /// <summary>覆盖式设置用户的角色集合。</summary>
    [HttpPut("{id:long}/roles")]
    [Authorize(Policy = PermissionCatalog.RoleWrite)]
    [ProducesResponseType(typeof(UserDetailDto), StatusCodes.Status200OK)]
    public async Task<UserDetailDto> AssignRoles(
        long id,
        AssignRolesRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(new AssignUserRolesCommand(id, request.RoleIds), cancellationToken);

    /// <summary>取回用户挂载的组织标签与完整组织路径。</summary>
    [HttpGet("{id:long}/tags")]
    [ProducesResponseType(typeof(UserTagsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<UserTagsResponse> GetTags(long id, CancellationToken cancellationToken) =>
        await _mediator.Send(new GetUserTagsQuery(id), cancellationToken);

    /// <summary>覆盖式设置用户挂载的组织维度标签。</summary>
    [HttpPut("{id:long}/tags")]
    [Authorize(Policy = PermissionCatalog.UserTagAssign)]
    [ProducesResponseType(typeof(UserTagsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<UserTagsResponse> AssignTags(
        long id,
        AssignTagsRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(new AssignUserTagsCommand(id, request.TagIds), cancellationToken);

    /// <summary>撤销用户的某个角色。</summary>
    [HttpDelete("{id:long}/roles/{roleId:long}")]
    [Authorize(Policy = PermissionCatalog.RoleWrite)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> RevokeRole(
        long id,
        long roleId,
        CancellationToken cancellationToken)
    {
        await _mediator.Send(new RevokeUserRoleCommand(id, roleId), cancellationToken);
        return NoContent();
    }
}

public sealed record ResetPasswordRequest(string? NewPassword);

using Exam.Application.Identity.Commands;
using Exam.Application.Identity.Contracts;
using Exam.Application.Identity.Queries;
using Exam.Domain.Identity;
using Exam.Web.Api.Contracts;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Controllers;

/// <summary>角色与权限点。系统内置角色不可删除，只能调整其权限集合。</summary>
[ApiController]
[Route("api/v1/roles")]
[Authorize]
public sealed class RolesController : ControllerBase
{
    private readonly IMediator _mediator;

    public RolesController(IMediator mediator) => _mediator = mediator;

    /// <summary>
    /// 列出全部角色及其权限点。
    /// <para>
    /// 读角色目录按 **user:read** 判定：角色目录是用户管理的配套数据——
    /// 管用户的人（内容管理员也算）要能看到有哪些角色、才能在用户页上认得出
    /// 每个人身上挂的角色。角色与权限的**配置**（改权限集合）仍要 role:write。
    /// </para>
    /// </summary>
    [HttpGet]
    [Authorize(Policy = PermissionCatalog.UserRead)]
    [ProducesResponseType(typeof(IReadOnlyList<RoleDto>), StatusCodes.Status200OK)]
    public async Task<IReadOnlyList<RoleDto>> List(CancellationToken cancellationToken) =>
        await _mediator.Send(new ListRolesQuery(), cancellationToken);

    /// <summary>新建自定义角色。</summary>
    [HttpPost]
    [Authorize(Policy = PermissionCatalog.RoleWrite)]
    [ProducesResponseType(typeof(RoleDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<RoleDto> Create(CreateRoleRequest request, CancellationToken cancellationToken) =>
        await _mediator.Send(
            new CreateRoleCommand(
                request.Code,
                request.Name,
                request.Description,
                request.PermissionCodes ?? []),
            cancellationToken);

    /// <summary>修改角色名称、说明与权限集合。</summary>
    [HttpPut("{id:long}")]
    [Authorize(Policy = PermissionCatalog.RoleWrite)]
    [ProducesResponseType(typeof(RoleDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<RoleDto> Update(
        long id,
        UpdateRoleRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new UpdateRoleCommand(
                id,
                request.Name,
                request.Description,
                request.PermissionCodes ?? []),
            cancellationToken);
}

/// <summary>权限点目录。管理端角色权限矩阵用。</summary>
[ApiController]
[Route("api/v1/permissions")]
[Authorize]
public sealed class PermissionsController : ControllerBase
{
    private readonly IMediator _mediator;

    public PermissionsController(IMediator mediator) => _mediator = mediator;

    /// <summary>全部权限点。前端按权限码显示入口——但权限的判定权始终在后端。</summary>
    [HttpGet]
    [Authorize(Policy = PermissionCatalog.RoleRead)]
    [ProducesResponseType(typeof(IReadOnlyList<PermissionDto>), StatusCodes.Status200OK)]
    public async Task<IReadOnlyList<PermissionDto>> List(CancellationToken cancellationToken) =>
        await _mediator.Send(new ListPermissionsQuery(), cancellationToken);
}

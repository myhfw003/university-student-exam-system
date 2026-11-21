using Exam.Application.Settings.Commands;
using Exam.Application.Settings.Contracts;
using Exam.Application.Settings.Queries;
using Exam.Domain.Identity;
using Exam.Web.Api.Contracts;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Controllers;

/// <summary>
/// 系统级设置。
/// <para>
/// 全局生效的开关：管理员改一次，所有人一起变，学生端没有单独入口。
/// 读与写都要求权限点 <c>system:configure</c>——按需求文档 §1 的矩阵，
/// 这个权限只给系统管理员。
/// </para>
/// </summary>
[ApiController]
[Route("api/v1/settings")]
[Authorize]
public sealed class SystemSettingsController : ControllerBase
{
    private readonly IMediator _mediator;

    public SystemSettingsController(IMediator mediator) => _mediator = mediator;

    /// <summary>读取当前的系统级设置。</summary>
    /// <para>没配置过的项按默认值返回。</para>
    [HttpGet]
    [Authorize(Policy = PermissionCatalog.SystemConfigure)]
    [ProducesResponseType(typeof(SystemSettingsDto), StatusCodes.Status200OK)]
    public async Task<SystemSettingsDto> Get(CancellationToken cancellationToken) =>
        await _mediator.Send(new GetSystemSettingsQuery(), cancellationToken);

    /// <summary>修改系统级设置。</summary>
    /// <para>改完立即生效，不用重启。</para>
    [HttpPut]
    [Authorize(Policy = PermissionCatalog.SystemConfigure)]
    [ProducesResponseType(typeof(SystemSettingsDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<SystemSettingsDto> Update(
        UpdateSystemSettingsRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new UpdateSystemSettingsCommand(request.MistakeResolutionPolicy),
            cancellationToken);
}

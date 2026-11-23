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

    /// <summary>设置系统的原始密码。</summary>
    /// <para>
    /// 管理员重置任意用户密码时置成它。**只写不回显**：接口不返回密码本身，
    /// 也不提供读回，管理端只看得到「有没有配置」。
    /// </para>
    [HttpPut("original-password")]
    [Authorize(Policy = PermissionCatalog.SystemConfigure)]
    [ProducesResponseType(typeof(SystemSettingsDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<SystemSettingsDto> SetOriginalPassword(
        SetOriginalPasswordRequest request,
        CancellationToken cancellationToken)
    {
        await _mediator.Send(
            new SetOriginalPasswordCommand(request.Password),
            cancellationToken);

        return await _mediator.Send(new GetSystemSettingsQuery(), cancellationToken);
    }

    /// <summary>清除系统的原始密码。</summary>
    /// <para>
    /// 清除后重置密码会被拒绝（没有可置成的目标），直到重新配置。
    /// </para>
    [HttpDelete("original-password")]
    [Authorize(Policy = PermissionCatalog.SystemConfigure)]
    [ProducesResponseType(typeof(SystemSettingsDto), StatusCodes.Status200OK)]
    public async Task<SystemSettingsDto> ClearOriginalPassword(
        CancellationToken cancellationToken)
    {
        await _mediator.Send(new ClearOriginalPasswordCommand(), cancellationToken);

        return await _mediator.Send(new GetSystemSettingsQuery(), cancellationToken);
    }
}

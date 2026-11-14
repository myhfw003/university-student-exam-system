using Exam.Application.Audit.Contracts;
using Exam.Application.Audit.Queries;
using Exam.Domain.Identity;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Controllers;

/// <summary>审计日志查询。日志是追加式的：只能读，不能改、不能删。</summary>
[ApiController]
[Route("api/v1/audit-logs")]
[Authorize]
public sealed class AuditLogsController : ControllerBase
{
    private readonly IMediator _mediator;

    public AuditLogsController(IMediator mediator) => _mediator = mediator;

    /// <summary>分页查询审计日志。支持按动作、目标、操作人与时间范围过滤。</summary>
    [HttpGet]
    [Authorize(Policy = PermissionCatalog.AuditRead)]
    [ProducesResponseType(typeof(AuditLogListResponse), StatusCodes.Status200OK)]
    public async Task<AuditLogListResponse> List(
        [FromQuery] string? action,
        [FromQuery] string? targetType,
        [FromQuery] string? targetId,
        [FromQuery] long? operatorId,
        [FromQuery] DateTimeOffset? from,
        [FromQuery] DateTimeOffset? to,
        [FromQuery] int page = 1,
        [FromQuery] int size = 20,
        CancellationToken cancellationToken = default) =>
        await _mediator.Send(
            new ListAuditLogsQuery(action, targetType, targetId, operatorId, from, to, page, size),
            cancellationToken);
}

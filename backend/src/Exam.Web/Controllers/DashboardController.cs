using Exam.Application.Learning.Contracts;
using Exam.Application.Learning.Queries;
using Exam.Domain.Identity;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Controllers;

/// <summary>学生工作台。</summary>
[ApiController]
[Route("api/v1/dashboard")]
[Authorize]
public sealed class DashboardController : ControllerBase
{
    private readonly IMediator _mediator;

    public DashboardController(IMediator mediator) => _mediator = mediator;

    /// <summary>
    /// 工作台汇总：统计卡、进行中的考试、推荐练习、最近成绩、成绩趋势与错题分布。
    /// </summary>
    [HttpGet("summary")]
    [Authorize(Policy = PermissionCatalog.AttemptReadOwn)]
    [ProducesResponseType(typeof(DashboardSummaryResponse), StatusCodes.Status200OK)]
    public async Task<DashboardSummaryResponse> Summary(CancellationToken cancellationToken = default) =>
        await _mediator.Send(new GetDashboardSummaryQuery(), cancellationToken);
}

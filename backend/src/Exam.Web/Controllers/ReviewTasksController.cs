using Exam.Application.Grading.Contracts;
using Exam.Application.Grading.Queries;
using Exam.Domain.Identity;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Controllers;

/// <summary>阅卷任务队列。</summary>
[ApiController]
[Route("api/v1/review-tasks")]
[Authorize]
public sealed class ReviewTasksController : ControllerBase
{
    private readonly IMediator _mediator;

    public ReviewTasksController(IMediator mediator) => _mediator = mediator;

    /// <summary>阅卷任务队列。</summary>
    [HttpGet]
    [Authorize(Policy = PermissionCatalog.ReviewGrade)]
    [ProducesResponseType(typeof(ReviewTaskListResponse), StatusCodes.Status200OK)]
    public async Task<ReviewTaskListResponse> List(
        [FromQuery] string? status,
        [FromQuery] long? examSessionId,
        [FromQuery] bool mine = false,
        [FromQuery] int page = 1,
        [FromQuery] int size = 20,
        CancellationToken cancellationToken = default) =>
        await _mediator.Send(
            new ListReviewTasksQuery(status, examSessionId, mine, page, size),
            cancellationToken);

    /// <summary>阅卷任务计数（待领取 / 阅卷中 / 已阅完 / 我的）。</summary>
    [HttpGet("count")]
    [Authorize(Policy = PermissionCatalog.ReviewGrade)]
    [ProducesResponseType(typeof(ReviewTaskCountDto), StatusCodes.Status200OK)]
    public async Task<ReviewTaskCountDto> Count(
        [FromQuery] long? examSessionId,
        CancellationToken cancellationToken = default) =>
        await _mediator.Send(new GetReviewTaskCountQuery(examSessionId), cancellationToken);
}

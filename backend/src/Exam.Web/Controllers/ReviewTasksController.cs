using Exam.Application.Grading.Commands;
using Exam.Application.Grading.Contracts;
using Exam.Application.Grading.Queries;
using Exam.Domain.Identity;
using Exam.Web.Api.Contracts;
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
        [FromQuery] long? questionId,
        [FromQuery] long? assigneeId,
        [FromQuery] bool mine = false,
        [FromQuery] int page = 1,
        [FromQuery] int size = 20,
        CancellationToken cancellationToken = default) =>
        await _mediator.Send(
            new ListReviewTasksQuery(status, examSessionId, questionId, assigneeId, mine, page, size),
            cancellationToken);

    /// <summary>阅卷任务计数（待领取 / 阅卷中 / 已阅完 / 我的）。</summary>
    [HttpGet("count")]
    [Authorize(Policy = PermissionCatalog.ReviewGrade)]
    [ProducesResponseType(typeof(ReviewTaskCountDto), StatusCodes.Status200OK)]
    public async Task<ReviewTaskCountDto> Count(
        [FromQuery] long? examSessionId,
        CancellationToken cancellationToken = default) =>
        await _mediator.Send(new GetReviewTaskCountQuery(examSessionId), cancellationToken);

    /// <summary>阅卷卷宗详情：作答原文、参考答案与系统初判的要点命中。</summary>
    [HttpGet("{id:long}")]
    [Authorize(Policy = PermissionCatalog.ReviewGrade)]
    [ProducesResponseType(typeof(ReviewTaskDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ReviewTaskDetailDto> Get(long id, CancellationToken cancellationToken = default) =>
        await _mediator.Send(new GetReviewTaskDetailQuery(id), cancellationToken);

    /// <summary>
    /// 领取阅卷任务。先到先得：任务被别人领走后再领就失败。
    /// </summary>
    [HttpPost("{id:long}/claim")]
    [Authorize(Policy = PermissionCatalog.ReviewGrade)]
    [ProducesResponseType(typeof(ReviewTaskDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<ReviewTaskDto> Claim(long id, CancellationToken cancellationToken = default) =>
        await _mediator.Send(new ClaimReviewTaskCommand(id), cancellationToken);

    /// <summary>指派阅卷任务给指定阅卷人。</summary>
    [HttpPost("{id:long}/assign")]
    [Authorize(Policy = PermissionCatalog.ReviewGrade)]
    [ProducesResponseType(typeof(ReviewTaskDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<ReviewTaskDto> Assign(
        long id,
        AssignReviewTaskRequest request,
        CancellationToken cancellationToken = default) =>
        await _mediator.Send(new AssignReviewTaskCommand(id, request.UserId), cancellationToken);

    /// <summary>
    /// 人工评分。分数 0..满分、0.5 为步进；每次评分都追加一条改分流水，学生端看得见。
    /// </summary>
    [HttpPost("{id:long}/grade")]
    [Authorize(Policy = PermissionCatalog.ReviewGrade)]
    [ProducesResponseType(typeof(GradeReviewTaskResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<GradeReviewTaskResponse> Grade(
        long id,
        GradeReviewTaskRequest request,
        CancellationToken cancellationToken = default) =>
        await _mediator.Send(
            new GradeReviewTaskCommand(id, request.Score, request.Comment),
            cancellationToken);

    /// <summary>
    /// 批量采纳初判建议。只影响待领取的任务，逐条给出采纳与跳过的结果。
    /// </summary>
    [HttpPost("batch-adopt")]
    [Authorize(Policy = PermissionCatalog.ReviewBatchAdopt)]
    [ProducesResponseType(typeof(BatchAdoptResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<BatchAdoptResponse> BatchAdopt(
        BatchAdoptReviewTasksRequest request,
        CancellationToken cancellationToken = default) =>
        await _mediator.Send(
            new BatchAdoptReviewTasksCommand(
                request.TaskIds,
                request.ExamSessionId,
                request.QuestionId,
                request.MaxCount,
                request.Comment,
                request.Confirm),
            cancellationToken);

    /// <summary>队列中的上一份 / 下一份，连续阅卷用。</summary>
    [HttpGet("{id:long}/neighbors")]
    [Authorize(Policy = PermissionCatalog.ReviewGrade)]
    [ProducesResponseType(typeof(ReviewTaskNeighborsDto), StatusCodes.Status200OK)]
    public async Task<ReviewTaskNeighborsDto> Neighbors(
        long id,
        [FromQuery] string? status,
        [FromQuery] long? examSessionId,
        [FromQuery] long? questionId,
        [FromQuery] long? assigneeId,
        [FromQuery] bool mine = false,
        CancellationToken cancellationToken = default) =>
        await _mediator.Send(
            new GetReviewTaskNeighborsQuery(id, status, examSessionId, questionId, assigneeId, mine),
            cancellationToken);
}

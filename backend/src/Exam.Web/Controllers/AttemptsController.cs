using Exam.Application.Common.Interfaces;
using Exam.Application.Delivery.Commands;
using Exam.Application.Delivery.Contracts;
using Exam.Application.Delivery.Queries;
using Exam.Domain.Identity;
using Exam.Web.Api.Contracts;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Controllers;

/// <summary>作答会话（学生端核心）。</summary>
[ApiController]
[Route("api/v1/attempts")]
[Authorize]
public sealed class AttemptsController : ControllerBase
{
    private readonly IMediator _mediator;

    public AttemptsController(IMediator mediator) => _mediator = mediator;

    /// <summary>我的会话列表。</summary>
    [HttpGet]
    [Authorize(Policy = PermissionCatalog.AttemptReadOwn)]
    [ProducesResponseType(typeof(AttemptListResponse), StatusCodes.Status200OK)]
    public async Task<AttemptListResponse> List(CancellationToken cancellationToken = default) =>
        await _mediator.Send(new ListAttemptsQuery(), cancellationToken);

    /// <summary>开始作答。已有进行中的会话时返回同一个会话（幂等）。</summary>
    [HttpPost]
    [Authorize(Policy = PermissionCatalog.AttemptTake)]
    [ProducesResponseType(typeof(AttemptResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<AttemptResponse> Start(
        StartAttemptRequest? request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new StartAttemptCommand(request?.ExamSessionId, request?.PracticeAssignmentId),
            cancellationToken);

    /// <summary>批量保存答案。同一批 clientSeq 重复提交整体忽略。</summary>
    [HttpPost("{id:long}/answers")]
    [Authorize(Policy = PermissionCatalog.AttemptTake)]
    [ProducesResponseType(typeof(SaveAnswersResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<SaveAnswersResponse> SaveAnswers(
        long id,
        SaveAnswersRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new SaveAnswersCommand(id, ToInput(request)),
            cancellationToken);

    private static SaveAnswersInput ToInput(SaveAnswersRequest request)
    {
        var items = (request.Items ?? [])
            .Select(i => new SaveAnswerItemInput(
                i.QuestionId,
                new AnswerPayloadInput(
                    i.Payload?.SelectedOptionKeys,
                    i.Payload?.Text,
                    i.Payload?.Steps?
                        .Select(s => new AnswerStepInput(s.Code, s.Text))
                        .ToList())))
            .ToList();

        return new SaveAnswersInput(request.ClientSeq, items, request.ClientSentAt);
    }

    /// <summary>交卷。重复交卷返回同一个结果。</summary>
    [HttpPost("{id:long}/submit")]
    [Authorize(Policy = PermissionCatalog.AttemptTake)]
    [ProducesResponseType(typeof(SubmitAttemptResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<SubmitAttemptResponse> Submit(
        long id,
        SubmitAttemptRequest? request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(new SubmitAttemptCommand(id, request?.Reason), cancellationToken);

    /// <summary>上报焦点事件。切屏计数以服务端为准。</summary>
    [HttpPost("{id:long}/focus-events")]
    [Authorize(Policy = PermissionCatalog.AttemptTake)]
    [ProducesResponseType(typeof(FocusEventsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<FocusEventsResponse> ReportFocusEvents(
        long id,
        ReportFocusEventsRequest? request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new ReportFocusEventsCommand(
                id,
                new ReportFocusEventsInput(
                    (request?.Events ?? [])
                        .Select(e => new FocusEventInput(e.Type, e.QuestionId, e.ClientAt))
                        .ToList())),
            cancellationToken);

    /// <summary>心跳。断连次数超限时按断网超时代交。</summary>
    [HttpPost("{id:long}/heartbeat")]
    [Authorize(Policy = PermissionCatalog.AttemptTake)]
    [ProducesResponseType(typeof(HeartbeatResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<HeartbeatResponse> Heartbeat(long id, CancellationToken cancellationToken) =>
        await _mediator.Send(new HeartbeatAttemptCommand(id), cancellationToken);

    /// <summary>监考处置：警告 / 备注 / 强制交卷。</summary>
    [HttpPost("{id:long}/proctor-actions")]
    [Authorize(Policy = PermissionCatalog.ProctorAct)]
    [ProducesResponseType(typeof(ProctorActionDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<ProctorActionDto> CreateProctorAction(
        long id,
        CreateProctorActionRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new CreateProctorActionCommand(id, request.ActionType, request.Message, request.Reason),
            cancellationToken);

    /// <summary>监考处置历史。</summary>
    [HttpGet("{id:long}/proctor-actions")]
    [Authorize(Policy = PermissionCatalog.ProctorMonitor)]
    [ProducesResponseType(typeof(ProctorActionListResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ProctorActionListResponse> ListProctorActions(long id, CancellationToken cancellationToken) =>
        await _mediator.Send(new ListProctorActionsQuery(id), cancellationToken);

    /// <summary>取回一次作答的成绩（含逐题明细）。</summary>
    [HttpGet("{id:long}/scores")]
    [Authorize(Policy = PermissionCatalog.AttemptReadOwn)]
    [ProducesResponseType(typeof(AttemptScoreSummaryDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<AttemptScoreSummaryDto> GetScores(long id, CancellationToken cancellationToken) =>
        await _mediator.Send(new GetAttemptScoresQuery(id), cancellationToken);

    /// <summary>恢复作答状态。</summary>
    [HttpGet("{id:long}")]
    [Authorize(Policy = PermissionCatalog.AttemptReadOwn)]
    [ProducesResponseType(typeof(AttemptResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<AttemptResponse> Get(long id, CancellationToken cancellationToken) =>
        await _mediator.Send(new GetAttemptQuery(id), cancellationToken);
}

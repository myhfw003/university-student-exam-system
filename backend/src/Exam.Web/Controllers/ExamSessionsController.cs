using Exam.Application.Common.Interfaces;
using Exam.Application.Delivery.Commands;
using Exam.Application.Delivery.Contracts;
using Exam.Application.Delivery.Queries;
using Exam.Application.Grading.Commands;
using Exam.Application.Grading.Contracts;
using Exam.Application.Grading.Queries;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Exceptions;
using Exam.Web.Api.Contracts;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Controllers;

/// <summary>考试场次管理。场次发布时绑定试卷快照，题目之后怎么改都不影响这场考试。</summary>
[ApiController]
[Route("api/v1/exam-sessions")]
[Authorize]
public sealed class ExamSessionsController : ControllerBase
{
    private readonly IMediator _mediator;

    public ExamSessionsController(IMediator mediator) => _mediator = mediator;

    /// <summary>分页查询考试场次。</summary>
    [HttpGet]
    [Authorize(Policy = PermissionCatalog.ExamRead)]
    [ProducesResponseType(typeof(ExamSessionListResponse), StatusCodes.Status200OK)]
    public async Task<ExamSessionListResponse> List(
        [FromQuery] string? status,
        [FromQuery] string? keyword,
        [FromQuery] int page = 1,
        [FromQuery] int size = 20,
        CancellationToken cancellationToken = default) =>
        await _mediator.Send(new ListExamSessionsQuery(status, keyword, page, size), cancellationToken);

    /// <summary>取回场次详情。</summary>
    [HttpGet("{id:long}")]
    [Authorize(Policy = PermissionCatalog.ExamRead)]
    [ProducesResponseType(typeof(ExamSessionDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ExamSessionDetailDto> Get(long id, CancellationToken cancellationToken) =>
        await _mediator.Send(new GetExamSessionQuery(id), cancellationToken);

    /// <summary>
    /// 发布成绩。全部成绩（<c>all</c>）或只发布客观题（<c>objective_only</c>）。
    /// </summary>
    [HttpPost("{id:long}/publish-grades")]
    [Authorize(Policy = PermissionCatalog.GradePublish)]
    [ProducesResponseType(typeof(GradePublicationDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<GradePublicationDto> PublishGrades(
        long id,
        PublishGradesRequest request,
        CancellationToken cancellationToken = default) =>
        await _mediator.Send(
            new PublishExamGradesCommand(id, request.Scope, request.IncludeAttemptIds),
            cancellationToken);

    /// <summary>场次成绩列表（教师视角）。</summary>
    [HttpGet("{id:long}/grades")]
    [Authorize(Policy = PermissionCatalog.AnalyticsRead)]
    [ProducesResponseType(typeof(ExamSessionGradeListResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ExamSessionGradeListResponse> Grades(
        long id,
        CancellationToken cancellationToken = default) =>
        await _mediator.Send(new GetExamSessionGradesQuery(id), cancellationToken);

    /// <summary>新建考试场次。</summary>
    [HttpPost]
    [Authorize(Policy = PermissionCatalog.ExamWrite)]
    [ProducesResponseType(typeof(ExamSessionDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<ExamSessionDetailDto> Create(
        CreateExamSessionRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new CreateExamSessionCommand(
                request.PaperId,
                request.Name,
                request.OpenAt,
                request.CloseAt,
                request.DurationMinutes,
                request.ParticipantMode,
                request.ParticipantTagIds,
                request.ParticipantUserIds,
                request.VariantRule,
                request.Rules,
                request.Note),
            cancellationToken);

    /// <summary>修改场次配置。只有未发布的场次能改。</summary>
    [HttpPut("{id:long}")]
    [Authorize(Policy = PermissionCatalog.ExamWrite)]
    [ProducesResponseType(typeof(ExamSessionDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<ExamSessionDetailDto> Update(
        long id,
        UpdateExamSessionRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new UpdateExamSessionCommand(
                id,
                request.Name,
                request.OpenAt,
                request.CloseAt,
                request.DurationMinutes,
                request.ParticipantMode,
                request.ParticipantTagIds,
                request.ParticipantUserIds,
                request.VariantRule,
                request.Rules,
                request.Note),
            cancellationToken);

    /// <summary>发布场次。试卷必须已发布并有快照。</summary>
    [HttpPost("{id:long}/publish")]
    [Authorize(Policy = PermissionCatalog.ExamPublish)]
    [ProducesResponseType(typeof(ExamSessionDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<ExamSessionDetailDto> Publish(long id, CancellationToken cancellationToken) =>
        await _mediator.Send(new PublishExamSessionCommand(id), cancellationToken);

    /// <summary>监考初始快照。实时通道断线重连后也用它补齐数据。</summary>
    [HttpGet("{id:long}/monitoring")]
    [Authorize(Policy = PermissionCatalog.ProctorMonitor)]
    [ProducesResponseType(typeof(ExamStatusBatchDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ExamStatusBatchDto> GetMonitoring(long id, CancellationToken cancellationToken) =>
        await _mediator.Send(new GetExamMonitoringQuery(id), cancellationToken);

    /// <summary>取回场次名单。</summary>
    [HttpGet("{id:long}/participants")]
    [Authorize(Policy = PermissionCatalog.ExamRead)]
    [ProducesResponseType(typeof(ExamParticipantListResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ExamParticipantListResponse> ListParticipants(
        long id,
        CancellationToken cancellationToken) =>
        await _mediator.Send(new ListExamParticipantsQuery(id), cancellationToken);

    /// <summary>设置场次名单（按组织标签）。已发布的场次会立即重新物化。</summary>
    [HttpPut("{id:long}/participants")]
    [Authorize(Policy = PermissionCatalog.ExamWrite)]
    [ProducesResponseType(typeof(ExamParticipantListResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<ExamParticipantListResponse> SetParticipants(
        long id,
        SetExamParticipantsRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new SetExamParticipantsCommand(id, request.ParticipantTagIds ?? []),
            cancellationToken);

    /// <summary>场次名单 CSV 导入。导入的是已有账号，导入后名单口径切到「指定考生」。</summary>
    [HttpPost("{id:long}/participants/import")]
    [Authorize(Policy = PermissionCatalog.ExamWrite)]
    [RequestSizeLimit(11 * 1024 * 1024)]
    [ProducesResponseType(typeof(ExamParticipantImportResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<ExamParticipantImportResult> ImportParticipants(
        long id,
        IFormFile? file,
        CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0)
        {
            throw new BusinessRuleException("请选择要上传的名单文件。");
        }

        await using var stream = file.OpenReadStream();
        using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer, cancellationToken);

        return await _mediator.Send(
            new ImportExamParticipantsCommand(id, buffer.ToArray(), file.FileName),
            cancellationToken);
    }

    /// <summary>场次负责人。被指派的人看得到这场考试的全部作答与监考数据。</summary>
    [HttpGet("{id:long}/assignments")]
    [Authorize(Policy = PermissionCatalog.ExamRead)]
    [ProducesResponseType(typeof(ExamSessionAssignmentListResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ExamSessionAssignmentListResponse> ListAssignments(
        long id,
        CancellationToken cancellationToken) =>
        await _mediator.Send(new ListExamSessionAssignmentsQuery(id), cancellationToken);

    /// <summary>设置场次负责人（覆盖式）。指派不授予权限，只界定能看哪些场次。</summary>
    [HttpPut("{id:long}/assignments")]
    [Authorize(Policy = PermissionCatalog.ExamWrite)]
    [ProducesResponseType(typeof(ExamSessionAssignmentListResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<ExamSessionAssignmentListResponse> SetAssignments(
        long id,
        SetExamSessionAssignmentsRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new SetExamSessionAssignmentsCommand(id, request.UserIds ?? []),
            cancellationToken);

    /// <summary>关闭场次。</summary>
    [HttpPost("{id:long}/close")]
    [Authorize(Policy = PermissionCatalog.ExamPublish)]
    [ProducesResponseType(typeof(ExamSessionDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<ExamSessionDetailDto> Close(long id, CancellationToken cancellationToken) =>
        await _mediator.Send(new CloseExamSessionCommand(id), cancellationToken);

    /// <summary>取消场次。已开始的会话拒绝继续作答，已提交的保留。</summary>
    [HttpPost("{id:long}/cancel")]
    [Authorize(Policy = PermissionCatalog.ExamPublish)]
    [ProducesResponseType(typeof(ExamSessionDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<ExamSessionDetailDto> Cancel(long id, CancellationToken cancellationToken) =>
        await _mediator.Send(new CancelExamSessionCommand(id), cancellationToken);
}

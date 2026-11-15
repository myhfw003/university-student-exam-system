using Exam.Application.Learning.Commands;
using Exam.Application.Learning.Contracts;
using Exam.Application.Learning.Queries;
using Exam.Domain.Identity;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Controllers;

/// <summary>管理端练习管理。</summary>
[ApiController]
[Route("api/v1/practice-assignments")]
[Authorize]
public sealed class PracticeAssignmentsController : ControllerBase
{
    private readonly IMediator _mediator;

    public PracticeAssignmentsController(IMediator mediator) => _mediator = mediator;

    /// <summary>练习列表。可按关键词与状态过滤。</summary>
    [HttpGet]
    [Authorize(Policy = PermissionCatalog.PracticeRead)]
    [ProducesResponseType(typeof(PracticeAssignmentListResponse), StatusCodes.Status200OK)]
    public async Task<PracticeAssignmentListResponse> List(
        [FromQuery] string? keyword,
        [FromQuery] string? status,
        [FromQuery] int page = 1,
        [FromQuery] int size = 20,
        CancellationToken cancellationToken = default) =>
        await _mediator.Send(new ListPracticeAssignmentsQuery(keyword, status, page, size), cancellationToken);

    /// <summary>新建练习开放单。</summary>
    [HttpPost]
    [Authorize(Policy = PermissionCatalog.PracticeWrite)]
    [ProducesResponseType(typeof(PracticeAssignmentDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<PracticeAssignmentDto> Create(
        [FromBody] CreatePracticeAssignmentRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new CreatePracticeAssignmentCommand(
                request.PaperId,
                request.Title,
                request.ScopeTagIds,
                request.OpenAt,
                request.CloseAt),
            cancellationToken);

    /// <summary>改练习设置：标题、开放范围与开放期。</summary>
    [HttpPut("{id:long}")]
    [Authorize(Policy = PermissionCatalog.PracticeWrite)]
    [ProducesResponseType(typeof(PracticeAssignmentDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<PracticeAssignmentDto> Update(
        long id,
        [FromBody] UpdatePracticeAssignmentRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new UpdatePracticeAssignmentCommand(
                id,
                request.Title,
                request.ScopeTagIds,
                request.OpenAt,
                request.CloseAt),
            cancellationToken);

    /// <summary>上架。</summary>
    [HttpPost("{id:long}/publish")]
    [Authorize(Policy = PermissionCatalog.PracticeWrite)]
    [ProducesResponseType(typeof(PracticeAssignmentDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<PracticeAssignmentDto> Publish(
        long id,
        CancellationToken cancellationToken) =>
        await _mediator.Send(new PublishPracticeAssignmentCommand(id), cancellationToken);

    /// <summary>下架。下架之后学生就看不到这个练习了。</summary>
    [HttpPost("{id:long}/archive")]
    [Authorize(Policy = PermissionCatalog.PracticeWrite)]
    [ProducesResponseType(typeof(PracticeAssignmentDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<PracticeAssignmentDto> Archive(
        long id,
        CancellationToken cancellationToken) =>
        await _mediator.Send(new ArchivePracticeAssignmentCommand(id), cancellationToken);
}

/// <summary>新建练习开放单请求。</summary>
public sealed record CreatePracticeAssignmentRequest(
    long PaperId,
    string Title,
    IReadOnlyList<long>? ScopeTagIds,
    DateTimeOffset? OpenAt,
    DateTimeOffset? CloseAt);

/// <summary>改练习设置请求。</summary>
public sealed record UpdatePracticeAssignmentRequest(
    string Title,
    IReadOnlyList<long>? ScopeTagIds,
    DateTimeOffset? OpenAt,
    DateTimeOffset? CloseAt);

using Exam.Application.Common.Interfaces;
using Exam.Application.Learning.Commands;
using Exam.Application.Learning.Contracts;
using Exam.Application.Learning.Queries;
using Exam.Domain.Identity;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Controllers;

/// <summary>错题本。</summary>
[ApiController]
[Route("api/v1/mistakes")]
[Authorize]
public sealed class MistakesController : ControllerBase
{
    private readonly IMediator _mediator;

    public MistakesController(IMediator mediator) => _mediator = mediator;

    /// <summary>错题本。可按标签、题型、时间范围过滤。</summary>
    [HttpGet]
    [Authorize(Policy = PermissionCatalog.AttemptReadOwn)]
    [ProducesResponseType(typeof(MistakeListResponse), StatusCodes.Status200OK)]
    public async Task<MistakeListResponse> List(
        [FromQuery] long? tagId,
        [FromQuery] string? questionType,
        [FromQuery] DateTimeOffset? from,
        [FromQuery] DateTimeOffset? to,
        [FromQuery] bool includeResolved = false,
        [FromQuery] int page = 1,
        [FromQuery] int size = 20,
        CancellationToken cancellationToken = default) =>
        await _mediator.Send(
            new ListMistakesQuery(tagId, questionType, from, to, includeResolved, page, size),
            cancellationToken);

    /// <summary>标记已掌握：这道题不再留在错题本里。</summary>
    [HttpPost("{questionId:long}/resolve")]
    [Authorize(Policy = PermissionCatalog.AttemptReadOwn)]
    [ProducesResponseType(typeof(MistakeDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<MistakeDto> Resolve(
        long questionId,
        CancellationToken cancellationToken = default) =>
        await _mediator.Send(new ResolveMistakeCommand(questionId), cancellationToken);
}

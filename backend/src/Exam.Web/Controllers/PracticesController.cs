using Exam.Application.Common.Interfaces;
using Exam.Application.Learning.Contracts;
using Exam.Application.Learning.Queries;
using Exam.Domain.Identity;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Controllers;

/// <summary>练习中心（学生端）。</summary>
[ApiController]
[Route("api/v1/practices")]
[Authorize]
public sealed class PracticesController : ControllerBase
{
    private readonly IMediator _mediator;

    public PracticesController(IMediator mediator) => _mediator = mediator;

    /// <summary>可见练习列表。可按关键词与标签过滤。</summary>
    [HttpGet]
    [Authorize(Policy = PermissionCatalog.AttemptReadOwn)]
    [ProducesResponseType(typeof(PracticeListResponse), StatusCodes.Status200OK)]
    public async Task<PracticeListResponse> List(
        [FromQuery] string? keyword,
        [FromQuery] long? tagId,
        [FromQuery] int page = 1,
        [FromQuery] int size = 20,
        CancellationToken cancellationToken = default) =>
        await _mediator.Send(new ListPracticesQuery(keyword, tagId, page, size), cancellationToken);

    /// <summary>练习详情：题量、总分、规则与自己还能做几次。</summary>
    [HttpGet("{id:long}")]
    [Authorize(Policy = PermissionCatalog.AttemptReadOwn)]
    [ProducesResponseType(typeof(PracticeSummaryDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<PracticeSummaryDto> Get(long id, CancellationToken cancellationToken = default) =>
        await _mediator.Send(new GetPracticeQuery(id), cancellationToken);
}

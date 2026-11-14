using Exam.Application.Delivery.Contracts;
using Exam.Application.Delivery.Queries;
using Exam.Domain.Identity;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Controllers;

/// <summary>我的成绩。</summary>
[ApiController]
[Route("api/v1/my/results")]
[Authorize]
public sealed class MyResultsController : ControllerBase
{
    private readonly IMediator _mediator;

    public MyResultsController(IMediator mediator) => _mediator = mediator;

    /// <summary>我的成绩列表。</summary>
    [HttpGet]
    [Authorize(Policy = PermissionCatalog.AttemptReadOwn)]
    [ProducesResponseType(typeof(MyResultListResponse), StatusCodes.Status200OK)]
    public async Task<MyResultListResponse> List(CancellationToken cancellationToken = default) =>
        await _mediator.Send(new GetMyResultsQuery(), cancellationToken);
}

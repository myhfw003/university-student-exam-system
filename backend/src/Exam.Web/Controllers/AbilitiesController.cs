using Exam.Application.Common.Interfaces;
using Exam.Application.Learning.Contracts;
using Exam.Application.Learning.Queries;
using Exam.Domain.Identity;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Controllers;

/// <summary>能力画像。</summary>
[ApiController]
[Route("api/v1/abilities")]
[Authorize]
public sealed class AbilitiesController : ControllerBase
{
    private readonly IMediator _mediator;

    public AbilitiesController(IMediator mediator) => _mediator = mediator;

    /// <summary>我的能力画像。样本不足的画像不参与排序。</summary>
    [HttpGet("profile")]
    [Authorize(Policy = PermissionCatalog.AttemptReadOwn)]
    [ProducesResponseType(typeof(AbilityProfileResponse), StatusCodes.Status200OK)]
    public async Task<AbilityProfileResponse> Profile(CancellationToken cancellationToken = default) =>
        await _mediator.Send(new GetAbilityProfileQuery(), cancellationToken);
}

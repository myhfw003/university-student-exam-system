using Exam.Application.Authoring.Commands;
using Exam.Application.Authoring.Contracts;
using Exam.Application.Authoring.Queries;
using Exam.Domain.Identity;
using Exam.Web.Api.Contracts;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Controllers;

/// <summary>卷型模板。模板是一份可以照着摆的骨架，不是考卷。</summary>
[ApiController]
[Route("api/v1/paper-templates")]
[Authorize]
public sealed class PaperTemplatesController : ControllerBase
{
    private readonly IMediator _mediator;

    public PaperTemplatesController(IMediator mediator) => _mediator = mediator;

    /// <summary>列出卷型模板。</summary>
    [HttpGet]
    [Authorize(Policy = PermissionCatalog.PaperRead)]
    [ProducesResponseType(typeof(PaperTemplateListResponse), StatusCodes.Status200OK)]
    public async Task<PaperTemplateListResponse> List(
        [FromQuery] string? kind,
        [FromQuery] string? keyword,
        CancellationToken cancellationToken = default) =>
        await _mediator.Send(new ListPaperTemplatesQuery(kind, keyword), cancellationToken);

    /// <summary>取回模板详情。</summary>
    [HttpGet("{id:long}")]
    [Authorize(Policy = PermissionCatalog.PaperRead)]
    [ProducesResponseType(typeof(PaperTemplateDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<PaperTemplateDetailDto> Get(long id, CancellationToken cancellationToken) =>
        await _mediator.Send(new GetPaperTemplateQuery(id), cancellationToken);

    /// <summary>由试卷另存为模板。</summary>
    [HttpPost]
    [Authorize(Policy = PermissionCatalog.PaperWrite)]
    [ProducesResponseType(typeof(PaperTemplateDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<PaperTemplateDetailDto> Create(
        CreatePaperTemplateRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(new CreatePaperTemplateCommand(request.PaperId, request.Name), cancellationToken);

    /// <summary>把模板套用到目标试卷。已停用的题目会被跳过并逐条报告。</summary>
    [HttpPost("{id:long}/apply")]
    [Authorize(Policy = PermissionCatalog.PaperWrite)]
    [ProducesResponseType(typeof(TemplateApplyResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<TemplateApplyResponse> Apply(
        long id,
        ApplyPaperTemplateRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(new ApplyPaperTemplateCommand(id, request.PaperId), cancellationToken);
}

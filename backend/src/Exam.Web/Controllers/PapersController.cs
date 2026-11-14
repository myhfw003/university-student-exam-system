using Exam.Application.Authoring.Commands;
using Exam.Application.Authoring.Contracts;
using Exam.Application.Authoring.Queries;
using Exam.Domain.Identity;
using Exam.Web.Api.Contracts;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Controllers;

/// <summary>试卷管理。已发布的试卷题位不可改，需先撤回发布。</summary>
[ApiController]
[Route("api/v1/papers")]
[Authorize]
public sealed class PapersController : ControllerBase
{
    private readonly IMediator _mediator;

    public PapersController(IMediator mediator) => _mediator = mediator;

    /// <summary>分页查询试卷。</summary>
    [HttpGet]
    [Authorize(Policy = PermissionCatalog.PaperRead)]
    [ProducesResponseType(typeof(PaperListResponse), StatusCodes.Status200OK)]
    public async Task<PaperListResponse> List(
        [FromQuery] string? kind,
        [FromQuery] string? status,
        [FromQuery] string? keyword,
        [FromQuery] int page = 1,
        [FromQuery] int size = 20,
        CancellationToken cancellationToken = default) =>
        await _mediator.Send(new ListPapersQuery(kind, status, keyword, page, size), cancellationToken);

    /// <summary>取回试卷详情。</summary>
    [HttpGet("{id:long}")]
    [Authorize(Policy = PermissionCatalog.PaperRead)]
    [ProducesResponseType(typeof(PaperDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<PaperDetailDto> Get(long id, CancellationToken cancellationToken) =>
        await _mediator.Send(new GetPaperQuery(id), cancellationToken);

    /// <summary>新建试卷。</summary>
    [HttpPost]
    [Authorize(Policy = PermissionCatalog.PaperWrite)]
    [ProducesResponseType(typeof(PaperDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<PaperDetailDto> Create(CreatePaperRequest request, CancellationToken cancellationToken) =>
        await _mediator.Send(
            new CreatePaperCommand(
                request.Kind,
                request.Name,
                request.Batch,
                request.Description,
                request.TargetTotalScore,
                request.DurationMinutes,
                request.PassScore,
                request.Note,
                request.TagIds,
                request.OrderRule,
                request.VariantRule,
                request.AnswerPolicy,
                request.AllowRetake,
                request.RetakeKeepsBest,
                request.ExamRules,
                request.PracticeRules),
            cancellationToken);

    /// <summary>修改试卷元信息。</summary>
    [HttpPut("{id:long}")]
    [Authorize(Policy = PermissionCatalog.PaperWrite)]
    [ProducesResponseType(typeof(PaperDetailDto), StatusCodes.Status200OK)]
    public async Task<PaperDetailDto> Update(
        long id,
        UpdatePaperRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new UpdatePaperCommand(
                id,
                request.Name,
                request.Batch,
                request.Description,
                request.TargetTotalScore,
                request.DurationMinutes,
                request.PassScore,
                request.Note,
                request.TagIds,
                request.OrderRule,
                request.VariantRule,
                request.AnswerPolicy,
                request.AllowRetake,
                request.RetakeKeepsBest,
                request.ExamRules,
                request.PracticeRules),
            cancellationToken);

    /// <summary>删除试卷。只有草稿可删。</summary>
    [HttpDelete("{id:long}")]
    [Authorize(Policy = PermissionCatalog.PaperWrite)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<IActionResult> Delete(long id, CancellationToken cancellationToken)
    {
        await _mediator.Send(new DeletePaperCommand(id), cancellationToken);
        return NoContent();
    }

    /// <summary>整体替换题位集合。</summary>
    [HttpPut("{id:long}/items")]
    [Authorize(Policy = PermissionCatalog.PaperWrite)]
    [ProducesResponseType(typeof(PaperDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<PaperDetailDto> ReplaceItems(
        long id,
        ReplacePaperItemsRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new ReplacePaperItemsCommand(id, request.Items ?? []),
            cancellationToken);

    /// <summary>追加题位。</summary>
    [HttpPost("{id:long}/items")]
    [Authorize(Policy = PermissionCatalog.PaperWrite)]
    [ProducesResponseType(typeof(PaperDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<PaperDetailDto> AddItem(
        long id,
        AddPaperItemRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new AddPaperItemCommand(id, request.QuestionId, request.Score, request.SortOrder),
            cancellationToken);

    /// <summary>调整题位分值与顺序。</summary>
    [HttpPut("{id:long}/items/{itemId:long}")]
    [Authorize(Policy = PermissionCatalog.PaperWrite)]
    [ProducesResponseType(typeof(PaperDetailDto), StatusCodes.Status200OK)]
    public async Task<PaperDetailDto> UpdateItem(
        long id,
        long itemId,
        UpdatePaperItemRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new UpdatePaperItemCommand(id, itemId, request.Score, request.SortOrder),
            cancellationToken);

    /// <summary>移除题位。</summary>
    [HttpDelete("{id:long}/items/{itemId:long}")]
    [Authorize(Policy = PermissionCatalog.PaperWrite)]
    [ProducesResponseType(typeof(PaperDetailDto), StatusCodes.Status200OK)]
    public async Task<PaperDetailDto> RemoveItem(
        long id,
        long itemId,
        CancellationToken cancellationToken) =>
        await _mediator.Send(new RemovePaperItemCommand(id, itemId), cancellationToken);

    /// <summary>发布校验。不改变试卷状态。</summary>
    [HttpPost("{id:long}/validate")]
    [Authorize(Policy = PermissionCatalog.PaperRead)]
    [ProducesResponseType(typeof(PaperValidationResponse), StatusCodes.Status200OK)]
    public async Task<PaperValidationResponse> Validate(long id, CancellationToken cancellationToken) =>
        await _mediator.Send(new ValidatePaperQuery(id), cancellationToken);

    /// <summary>发布试卷。警告项需填写覆盖理由。</summary>
    [HttpPost("{id:long}/publish")]
    [Authorize(Policy = PermissionCatalog.PaperPublish)]
    [ProducesResponseType(typeof(PaperDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<PaperDetailDto> Publish(
        long id,
        [FromBody] PublishPaperRequest? request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new PublishPaperCommand(id, request?.WarningOverrideReason),
            cancellationToken);

    /// <summary>撤回发布。回到草稿，保留快照。</summary>
    [HttpPost("{id:long}/unpublish")]
    [Authorize(Policy = PermissionCatalog.PaperPublish)]
    [ProducesResponseType(typeof(PaperDetailDto), StatusCodes.Status200OK)]
    public async Task<PaperDetailDto> Unpublish(long id, CancellationToken cancellationToken) =>
        await _mediator.Send(new UnpublishPaperCommand(id), cancellationToken);

    /// <summary>归档 / 下架。</summary>
    [HttpPost("{id:long}/archive")]
    [Authorize(Policy = PermissionCatalog.PaperPublish)]
    [ProducesResponseType(typeof(PaperDetailDto), StatusCodes.Status200OK)]
    public async Task<PaperDetailDto> Archive(long id, CancellationToken cancellationToken) =>
        await _mediator.Send(new ArchivePaperCommand(id), cancellationToken);
}

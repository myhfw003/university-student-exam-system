using Exam.Application.Catalog.Commands;
using Exam.Application.Catalog.Contracts;
using Exam.Application.Catalog.Queries;
using Exam.Domain.Identity;
using Exam.Web.Api.Contracts;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Controllers;

/// <summary>题目管理。列表的过滤全部在服务端完成。</summary>
[ApiController]
[Route("api/v1/questions")]
[Authorize]
public sealed class QuestionsController : ControllerBase
{
    private readonly IMediator _mediator;

    public QuestionsController(IMediator mediator) => _mediator = mediator;

    /// <summary>分页查询题目。</summary>
    [HttpGet]
    [Authorize(Policy = PermissionCatalog.QuestionRead)]
    [ProducesResponseType(typeof(QuestionListResponse), StatusCodes.Status200OK)]
    public async Task<QuestionListResponse> List(
        [FromQuery] long? bankId,
        [FromQuery] string? type,
        [FromQuery] string? status,
        [FromQuery] long[]? tagIds = null,
        [FromQuery] bool includeDescendants = true,
        [FromQuery] string? matchMode = null,
        [FromQuery] long[]? difficultyTagIds = null,
        [FromQuery] string? keyword = null,
        [FromQuery] int page = 1,
        [FromQuery] int size = 20,
        [FromQuery] string? sortBy = "updatedAt",
        [FromQuery] bool sortDir = true,
        CancellationToken cancellationToken = default) =>
        await _mediator.Send(
            new ListQuestionsQuery(
                bankId,
                type,
                status,
                tagIds,
                includeDescendants,
                matchMode,
                difficultyTagIds,
                keyword,
                page,
                size,
                sortBy,
                sortDir),
            cancellationToken);

    /// <summary>可用筛选项。</summary>
    [HttpGet("filters")]
    [Authorize(Policy = PermissionCatalog.QuestionRead)]
    [ProducesResponseType(typeof(QuestionFilterOptionsDto), StatusCodes.Status200OK)]
    public async Task<QuestionFilterOptionsDto> Filters(CancellationToken cancellationToken) =>
        await _mediator.Send(new GetQuestionFiltersQuery(), cancellationToken);

    /// <summary>取回题目详情。</summary>
    [HttpGet("{id:long}")]
    [Authorize(Policy = PermissionCatalog.QuestionRead)]
    [ProducesResponseType(typeof(QuestionDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<QuestionDetailDto> Get(long id, CancellationToken cancellationToken) =>
        await _mediator.Send(new GetQuestionQuery(id), cancellationToken);

    /// <summary>新建题目。新建一律是草稿。</summary>
    [HttpPost]
    [Authorize(Policy = PermissionCatalog.QuestionWrite)]
    [ProducesResponseType(typeof(QuestionDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<QuestionDetailDto> Create(CreateQuestionRequest request, CancellationToken cancellationToken) =>
        await _mediator.Send(
            new CreateQuestionCommand(
                request.Code,
                request.Type,
                request.Stem,
                request.DefaultScore,
                request.TagIds ?? [],
                request.DifficultyTagId,
                request.Options,
                request.Keypoints,
                request.Steps,
                request.Analysis,
                request.ReferenceAnswer),
            cancellationToken);

    /// <summary>修改题目内容。</summary>
    [HttpPut("{id:long}")]
    [Authorize(Policy = PermissionCatalog.QuestionWrite)]
    [ProducesResponseType(typeof(QuestionDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<QuestionDetailDto> Update(
        long id,
        UpdateQuestionRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new UpdateQuestionCommand(
                id,
                request.Code,
                request.Type,
                request.Stem,
                request.DefaultScore,
                request.TagIds ?? [],
                request.DifficultyTagId,
                request.Options,
                request.Keypoints,
                request.Steps,
                request.Analysis,
                request.ReferenceAnswer),
            cancellationToken);

    /// <summary>删除题目。只有草稿可删。</summary>
    [HttpDelete("{id:long}")]
    [Authorize(Policy = PermissionCatalog.QuestionWrite)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<IActionResult> Delete(long id, CancellationToken cancellationToken)
    {
        await _mediator.Send(new DeleteQuestionCommand(id), cancellationToken);
        return NoContent();
    }

    /// <summary>发布题目。</summary>
    [HttpPost("{id:long}/publish")]
    [Authorize(Policy = PermissionCatalog.QuestionPublish)]
    [ProducesResponseType(typeof(QuestionDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<QuestionDetailDto> Publish(long id, CancellationToken cancellationToken) =>
        await _mediator.Send(new PublishQuestionCommand(id), cancellationToken);

    /// <summary>停用题目。</summary>
    [HttpPost("{id:long}/disable")]
    [Authorize(Policy = PermissionCatalog.QuestionPublish)]
    [ProducesResponseType(typeof(QuestionDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<QuestionDetailDto> Disable(long id, CancellationToken cancellationToken) =>
        await _mediator.Send(new DisableQuestionCommand(id), cancellationToken);

    /// <summary>恢复已停用的题目。</summary>
    [HttpPost("{id:long}/restore")]
    [Authorize(Policy = PermissionCatalog.QuestionPublish)]
    [ProducesResponseType(typeof(QuestionDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<QuestionDetailDto> Restore(long id, CancellationToken cancellationToken) =>
        await _mediator.Send(new RestoreQuestionCommand(id), cancellationToken);

    /// <summary>批量变更题目状态。逐条返回成功与失败原因。</summary>
    [HttpPost("batch-status")]
    [Authorize(Policy = PermissionCatalog.QuestionPublish)]
    [ProducesResponseType(typeof(BatchStatusResult), StatusCodes.Status200OK)]
    public async Task<BatchStatusResult> BatchStatus(
        BatchQuestionStatusRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new BatchQuestionStatusCommand(request.QuestionIds, request.TargetStatus),
            cancellationToken);
}

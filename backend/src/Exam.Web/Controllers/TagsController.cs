using Exam.Application.Catalog.Commands;
using Exam.Application.Catalog.Contracts;
using Exam.Application.Catalog.Queries;
using Exam.Domain.Identity;
using Exam.Web.Api.Contracts;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Controllers;

/// <summary>
/// 标签管理。五个维度共用一套接口，维度由 <c>group</c> 区分。
/// </summary>
[ApiController]
[Route("api/v1/tags")]
[Authorize]
public sealed class TagsController : ControllerBase
{
    private readonly IMediator _mediator;

    public TagsController(IMediator mediator) => _mediator = mediator;

    /// <summary>按维度分组返回全部标签（含引用计数）。</summary>
    [HttpGet]
    [Authorize(Policy = PermissionCatalog.TagRead)]
    [ProducesResponseType(typeof(TagGroupsResponse), StatusCodes.Status200OK)]
    public async Task<TagGroupsResponse> List(
        [FromQuery] string? group,
        CancellationToken cancellationToken) =>
        await _mediator.Send(new GetTagsQuery(group), cancellationToken);

    /// <summary>取回单个标签及其直接子标签。</summary>
    [HttpGet("{id:long}")]
    [Authorize(Policy = PermissionCatalog.TagRead)]
    [ProducesResponseType(typeof(TagDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<TagDetailDto> Get(long id, CancellationToken cancellationToken) =>
        await _mediator.Send(new GetTagQuery(id), cancellationToken);

    /// <summary>展开标签的全部后代（含子孙）。</summary>
    [HttpGet("{id:long}/descendants")]
    [Authorize(Policy = PermissionCatalog.TagRead)]
    [ProducesResponseType(typeof(TagDescendantsResponse), StatusCodes.Status200OK)]
    public async Task<TagDescendantsResponse> GetDescendants(
        long id,
        [FromQuery] bool includeSelf = true,
        CancellationToken cancellationToken = default) =>
        await _mediator.Send(new GetTagDescendantsQuery(id, includeSelf), cancellationToken);

    /// <summary>新建标签。</summary>
    [HttpPost]
    [Authorize(Policy = PermissionCatalog.TagWrite)]
    [ProducesResponseType(typeof(TagDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<TagDto> Create(CreateTagRequest request, CancellationToken cancellationToken)
    {
        var tag = await _mediator.Send(
            new CreateTagCommand(
                request.Code,
                request.Name,
                request.Group,
                request.ParentId,
                request.Level,
                request.Description,
                request.SortOrder),
            cancellationToken);

        return tag;
    }

    /// <summary>修改标签。</summary>
    [HttpPut("{id:long}")]
    [Authorize(Policy = PermissionCatalog.TagWrite)]
    [ProducesResponseType(typeof(TagDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<TagDto> Update(
        long id,
        UpdateTagRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new UpdateTagCommand(
                id,
                request.Name,
                request.ParentId,
                request.Level,
                request.Description,
                request.SortOrder),
            cancellationToken);

    /// <summary>删除标签（软删除）。</summary>
    [HttpDelete("{id:long}")]
    [Authorize(Policy = PermissionCatalog.TagWrite)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<IActionResult> Delete(long id, CancellationToken cancellationToken)
    {
        await _mediator.Send(new DeleteTagCommand(id), cancellationToken);
        return NoContent();
    }
}

using Exam.Application.Catalog.Commands;
using Exam.Application.Catalog.Contracts;
using Exam.Application.Catalog.Queries;
using Exam.Domain.Identity;
using Exam.Web.Api.Contracts;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Controllers;

/// <summary>题库管理。把题目移出题库不会删除题目本身。</summary>
[ApiController]
[Route("api/v1/question-banks")]
[Authorize]
public sealed class QuestionBanksController : ControllerBase
{
    private readonly IMediator _mediator;

    public QuestionBanksController(IMediator mediator) => _mediator = mediator;

    /// <summary>列出全部题库。</summary>
    [HttpGet]
    [Authorize(Policy = PermissionCatalog.BankRead)]
    [ProducesResponseType(typeof(IReadOnlyList<QuestionBankSummaryDto>), StatusCodes.Status200OK)]
    public async Task<IReadOnlyList<QuestionBankSummaryDto>> List(CancellationToken cancellationToken) =>
        await _mediator.Send(new ListQuestionBanksQuery(), cancellationToken);

    /// <summary>取回题库详情与统计。</summary>
    [HttpGet("{id:long}")]
    [Authorize(Policy = PermissionCatalog.BankRead)]
    [ProducesResponseType(typeof(QuestionBankDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<QuestionBankDetailDto> Get(long id, CancellationToken cancellationToken) =>
        await _mediator.Send(new GetQuestionBankQuery(id), cancellationToken);

    /// <summary>新建题库。</summary>
    [HttpPost]
    [Authorize(Policy = PermissionCatalog.BankWrite)]
    [ProducesResponseType(typeof(QuestionBankDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<QuestionBankDetailDto> Create(
        CreateQuestionBankRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new CreateQuestionBankCommand(request.Name, request.Description),
            cancellationToken);

    /// <summary>修改题库名称与说明。</summary>
    [HttpPut("{id:long}")]
    [Authorize(Policy = PermissionCatalog.BankWrite)]
    [ProducesResponseType(typeof(QuestionBankDetailDto), StatusCodes.Status200OK)]
    public async Task<QuestionBankDetailDto> Update(
        long id,
        UpdateQuestionBankRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new UpdateQuestionBankCommand(id, request.Name, request.Description),
            cancellationToken);

    /// <summary>删除题库。</summary>
    [HttpDelete("{id:long}")]
    [Authorize(Policy = PermissionCatalog.BankWrite)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(long id, CancellationToken cancellationToken)
    {
        await _mediator.Send(new DeleteQuestionBankCommand(id), cancellationToken);
        return NoContent();
    }

    /// <summary>批量把题目加入题库。</summary>
    [HttpPost("{id:long}/items")]
    [Authorize(Policy = PermissionCatalog.BankWrite)]
    [ProducesResponseType(typeof(QuestionBankDetailDto), StatusCodes.Status200OK)]
    public async Task<QuestionBankDetailDto> AddItems(
        long id,
        QuestionBankItemsRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new AddQuestionBankItemsCommand(id, request.QuestionIds),
            cancellationToken);

    /// <summary>批量把题目移出题库。题目本身不受影响。</summary>
    [HttpDelete("{id:long}/items")]
    [Authorize(Policy = PermissionCatalog.BankWrite)]
    [ProducesResponseType(typeof(QuestionBankDetailDto), StatusCodes.Status200OK)]
    public async Task<QuestionBankDetailDto> RemoveItems(
        long id,
        [FromBody] QuestionBankItemsRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new RemoveQuestionBankItemsCommand(id, request.QuestionIds),
            cancellationToken);
}

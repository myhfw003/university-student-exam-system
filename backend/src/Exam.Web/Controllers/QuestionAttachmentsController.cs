using Exam.Application.Catalog.Commands;
using Exam.Application.Catalog.Contracts;
using Exam.Application.Catalog.Queries;
using Exam.Domain.Identity;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Controllers;

/// <summary>
/// 题目附件。文件落在私有对象存储，外部只能通过短期签名 URL 访问。
/// </summary>
[ApiController]
[Route("api/v1/questions")]
[Authorize]
public sealed class QuestionAttachmentsController : ControllerBase
{
    private readonly IMediator _mediator;

    public QuestionAttachmentsController(IMediator mediator) => _mediator = mediator;

    /// <summary>上传附件。带 questionId 时直接挂到该题目上，否则返回引用供建题时使用。</summary>
    [HttpPost("attachments")]
    [Authorize(Policy = PermissionCatalog.QuestionWrite)]
    [RequestSizeLimit(11 * 1024 * 1024)]
    [ProducesResponseType(typeof(AttachmentDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<AttachmentDto> Upload(
        IFormFile? file,
        [FromQuery] long? questionId,
        CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0)
        {
            throw new Domain.SharedKernel.Exceptions.BusinessRuleException("请选择要上传的文件。");
        }

        await using var stream = file.OpenReadStream();
        using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer, cancellationToken);

        return await _mediator.Send(
            new UploadQuestionAttachmentCommand(
                buffer.ToArray(),
                file.FileName,
                file.ContentType,
                questionId),
            cancellationToken);
    }

    /// <summary>取回题目的附件清单。</summary>
    [HttpGet("{questionId:long}/attachments")]
    [Authorize(Policy = PermissionCatalog.QuestionRead)]
    [ProducesResponseType(typeof(IReadOnlyList<AttachmentDto>), StatusCodes.Status200OK)]
    public async Task<IReadOnlyList<AttachmentDto>> List(
        long questionId,
        CancellationToken cancellationToken) =>
        await _mediator.Send(new ListQuestionAttachmentsQuery(questionId), cancellationToken);

    /// <summary>生成附件的短期签名 URL。</summary>
    [HttpGet("{questionId:long}/attachments/{attachmentId:long}/url")]
    [Authorize(Policy = PermissionCatalog.QuestionRead)]
    [ProducesResponseType(typeof(AttachmentUrlDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<AttachmentUrlDto> GetUrl(
        long questionId,
        long attachmentId,
        [FromQuery] int expirySeconds = 300,
        CancellationToken cancellationToken = default) =>
        await _mediator.Send(
            new GetQuestionAttachmentUrlQuery(questionId, attachmentId, expirySeconds),
            cancellationToken);
}

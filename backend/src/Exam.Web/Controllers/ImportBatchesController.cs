using Exam.Application.Catalog.Commands;
using Exam.Application.Catalog.Contracts;
using Exam.Application.Catalog.Queries;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Exceptions;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Controllers;

/// <summary>
/// 试题导入批次。上传 → 解析（列映射建议 + 逐行结果）→ 调整映射重新解析 → 采纳为候选题。
/// </summary>
[ApiController]
[Route("api/v1/imports")]
[Authorize]
public sealed class ImportBatchesController : ControllerBase
{
    private readonly IMediator _mediator;

    public ImportBatchesController(IMediator mediator) => _mediator = mediator;

    /// <summary>分页查询导入批次。</summary>
    [HttpGet]
    [Authorize(Policy = PermissionCatalog.ImportRun)]
    [ProducesResponseType(typeof(ImportBatchListResponse), StatusCodes.Status200OK)]
    public async Task<ImportBatchListResponse> List(
        [FromQuery] int page = 1,
        [FromQuery] int size = 20,
        CancellationToken cancellationToken = default) =>
        await _mediator.Send(new ListImportBatchesQuery(page, size), cancellationToken);

    /// <summary>取回导入批次详情，含逐行结果。</summary>
    [HttpGet("{id:long}")]
    [Authorize(Policy = PermissionCatalog.ImportRun)]
    [ProducesResponseType(typeof(ImportBatchDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ImportBatchDetailDto> Get(long id, CancellationToken cancellationToken) =>
        await _mediator.Send(new GetImportBatchQuery(id), cancellationToken);

    /// <summary>上传试题文件并解析。返回列映射建议与逐行结果。</summary>
    [HttpPost]
    [Authorize(Policy = PermissionCatalog.ImportRun)]
    [RequestSizeLimit(21 * 1024 * 1024)]
    [ProducesResponseType(typeof(ImportBatchDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<ImportBatchDetailDto> Upload(
        IFormFile? file,
        CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0)
        {
            throw new BusinessRuleException("请选择要上传的文件。");
        }

        await using var stream = file.OpenReadStream();
        using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer, cancellationToken);

        return await _mediator.Send(
            new ImportQuestionFileCommand(buffer.ToArray(), file.FileName),
            cancellationToken);
    }

    /// <summary>调整列映射并重新解析。</summary>
    [HttpPut("{id:long}/mapping")]
    [Authorize(Policy = PermissionCatalog.ImportRun)]
    [ProducesResponseType(typeof(ImportBatchDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<ImportBatchDetailDto> UpdateMapping(
        long id,
        UpdateImportMappingRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new UpdateImportMappingCommand(id, request.Mapping ?? new Dictionary<string, string>()),
            cancellationToken);

    /// <summary>采纳批次为候选题（草稿）。重复采纳是幂等的。</summary>
    [HttpPost("{id:long}/adopt")]
    [Authorize(Policy = PermissionCatalog.ImportAdopt)]
    [ProducesResponseType(typeof(ImportAdoptResult), StatusCodes.Status200OK)]
    public async Task<ImportAdoptResult> Adopt(long id, CancellationToken cancellationToken) =>
        await _mediator.Send(new AdoptImportBatchCommand(id), cancellationToken);
}

public sealed record UpdateImportMappingRequest(IReadOnlyDictionary<string, string>? Mapping);

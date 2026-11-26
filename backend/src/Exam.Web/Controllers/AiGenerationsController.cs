using Exam.Application.Catalog.Commands;
using Exam.Application.Catalog.Contracts;
using Exam.Application.Catalog.Queries;
using Exam.Domain.Identity;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Controllers;

/// <summary>
/// 用大模型生成试题。
/// <para>
/// 两步：先问服务端有哪些供应商与模型可切（<c>GET /providers</c>），
/// 再按选定的模型生成（<c>POST /generations</c>）。
/// </para>
/// </summary>
[ApiController]
[Route("api/v1/ai")]
[Authorize]
public sealed class AiGenerationsController : ControllerBase
{
    private readonly IMediator _mediator;

    public AiGenerationsController(IMediator mediator) => _mediator = mediator;

    /// <summary>列出可用的供应商与可切换的模型。</summary>
    [HttpGet("providers")]
    [Authorize(Policy = PermissionCatalog.AiGenerate)]
    [ProducesResponseType(typeof(AiProviderListDto), StatusCodes.Status200OK)]
    public async Task<AiProviderListDto> Providers(CancellationToken cancellationToken) =>
        await _mediator.Send(new ListAiProvidersQuery(), cancellationToken);

    /// <summary>
    /// 生成试题。通过校验的题直接成为候选题（草稿），
    /// 通不过的题逐条给出原因，不落库。
    /// </summary>
    [HttpPost("generations")]
    [Authorize(Policy = PermissionCatalog.AiGenerate)]
    [ProducesResponseType(typeof(AiGenerationResultDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    [ProducesResponseType(StatusCodes.Status502BadGateway)]
    public async Task<AiGenerationResultDto> Generate(
        GenerateAiQuestionsRequest request,
        CancellationToken cancellationToken) =>
        await _mediator.Send(
            new GenerateAiQuestionsCommand(
                request.Provider,
                request.Model,
                request.Count,
                request.Type,
                request.DifficultyTagId,
                request.TagIds ?? [],
                request.Prompt),
            cancellationToken);
}

/// <summary>生成试题的请求。</summary>
public sealed record GenerateAiQuestionsRequest(
    string Provider,
    string? Model,
    int Count,
    string Type,
    long DifficultyTagId,
    IReadOnlyList<long>? TagIds,
    string Prompt);

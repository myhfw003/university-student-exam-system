using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Unicode;
using Exam.Application.Catalog.Commands;
using Exam.Application.Catalog.Contracts;
using Exam.Application.Catalog.Queries;
using Exam.Application.Catalog.Services;
using Exam.Application.Common.Exceptions;
using Exam.Domain.Catalog;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Exceptions;
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
    /// <summary>
    /// SSE 载荷的序列化选项。
    /// <para>
    /// **必须用 camelCase**：普通接口的 JSON 由 ASP.NET Core 序列化（默认 camelCase），
    /// 这里手写序列化，默认是 PascalCase——前端按 camelCase 读，
    /// 写成 PascalCase 就成了「事件收到了但字段全是空的」。
    /// </para>
    /// </summary>
    private static readonly JsonSerializerOptions SseJsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        // 中文按原样写：默认编码器会把中文转成 \uXXXX，
        // 日志与抓包看到的就全是转义码，排查时看不出是哪句提示。
        Encoder = JavaScriptEncoder.Create(UnicodeRanges.All),
    };

    private readonly IMediator _mediator;
    private readonly AiQuestionGenerationService _generation;

    public AiGenerationsController(IMediator mediator, AiQuestionGenerationService generation)
    {
        _mediator = mediator;
        _generation = generation;
    }

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

    /// <summary>
    /// 流式生成试题。
    /// <para>
    /// 服务器发的是 SSE：每道题**落库后立刻**推一条事件，界面上题目一道道出现，
    /// 不用等整批出完（8 道题实测 25–60 秒）。最后一条是「完成」，带整批计数。
    /// </para>
    /// </summary>
    [HttpPost("generations/stream")]
    [Authorize(Policy = PermissionCatalog.AiGenerate)]
    [Produces("text/event-stream")]
    public async Task Stream(
        GenerateAiQuestionsRequest request,
        CancellationToken cancellationToken)
    {
        // 这个端点绕过了 MediatR 管道（管道只能整体返回，不能流式），
        // 所以校验要自己做——**用与非流式端点同一份规则**，
        // 否则两个入口对同一个请求给出不同的结论。
        var errors = AiGenerationRequestRules.Validate(
            request.Provider,
            request.Count,
            request.Type,
            request.DifficultyTagId,
            request.TagIds,
            request.Prompt);

        if (errors.Count > 0)
        {
            throw new ValidationException(errors);
        }

        var type = QuestionTypes.FromName(request.Type) ?? QuestionTypes.FromStorage(request.Type)
            ?? throw new BusinessRuleException("题型无法识别。");

        var parameters = new AiGenerationParameters(
            request.Provider,
            request.Model,
            request.Count,
            type,
            request.DifficultyTagId,
            request.TagIds ?? [],
            request.Prompt);

        Response.ContentType = "text/event-stream; charset=utf-8";
        Response.Headers.CacheControl = "no-cache";
        // 让反向代理别缓冲这个响应：不缓冲，事件才是「一道道」到的。
        Response.Headers["X-Accel-Buffering"] = "no";

        try
        {
            await foreach (var evt in _generation.GenerateAsync(parameters, cancellationToken))
            {
                var (name, payload) = ToSse(evt);

                await Response.WriteAsync($"event: {name}\ndata: {payload}\n\n", cancellationToken);
                await Response.Body.FlushAsync(cancellationToken);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // 客户端断开（老师关了页面）：不是错误，安静收尾。
            throw;
        }
        catch (DomainException ex)
        {
            // 已经开始推事件了，改不了 HTTP 状态码：
            // 把错误当作一条事件推出去，前端据此提示，而不是让它看着像「生成完了」。
            await WriteEventAsync("error", ex.ErrorCode, ex.Message, cancellationToken);
        }
        catch (Exception ex)
        {
            await WriteEventAsync("error", 20500, $"生成中断：{ex.Message}", cancellationToken);
        }
    }

    /// <summary>推一条错误事件（流已开始时的错误出口）。</summary>
    private async Task WriteEventAsync(
        string name,
        int errorCode,
        string message,
        CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.Serialize(
            new AiGenerationStreamErrorDto(errorCode, message),
            SseJsonOptions);

        await Response.WriteAsync($"event: {name}\ndata: {payload}\n\n", cancellationToken);
        await Response.Body.FlushAsync(cancellationToken);
    }

    private static (string Name, string Payload) ToSse(AiGenerationEvent evt) => evt switch
    {
        AiQuestionReadyEvent ready => (
            "question",
            JsonSerializer.Serialize(
                new AiGenerationStreamItemDto(
                    ready.Index, true, ready.QuestionId, ready.Code, ready.Type, ready.Stem, ready.Score, []),
                SseJsonOptions)),

        AiQuestionFailedEvent failed => (
            "failed",
            JsonSerializer.Serialize(
                new AiGenerationStreamItemDto(
                    failed.Index, false, null, null, null, null, null, [failed.Error]),
                SseJsonOptions)),

        _ => ("done", JsonSerializer.Serialize(
            new AiGenerationStreamDoneDto(
                ((AiGenerationCompletedEvent)evt).Requested,
                ((AiGenerationCompletedEvent)evt).Succeeded,
                ((AiGenerationCompletedEvent)evt).Failed,
                ((AiGenerationCompletedEvent)evt).Provider,
                ((AiGenerationCompletedEvent)evt).ProviderName,
                ((AiGenerationCompletedEvent)evt).Model),
            SseJsonOptions)),
    };
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

namespace Exam.Application.Catalog.Contracts;

/// <summary>可用的 AI 供应商（界面上据此选模型）。</summary>
public sealed record AiProviderDto(
    string Name,
    string DisplayName,
    bool Configured,
    string DefaultModel,
    IReadOnlyList<string> Models);

/// <summary>供应商清单。</summary>
public sealed record AiProviderListDto(IReadOnlyList<AiProviderDto> Providers);

/// <summary>生成结果里的每一道题。</summary>
/// <param name="Index">第几道（从 1 开始）。</param>
/// <param name="Succeeded">是否已落库成候选题。</param>
/// <param name="QuestionId">落库的题目主键（成功时）。</param>
/// <param name="Code">题号（成功时）。</param>
/// <param name="Stem">题干（成功时）。</param>
/// <param name="Errors">失败原因（失败时）。</param>
public sealed record AiGenerationItemDto(
    int Index,
    bool Succeeded,
    long? QuestionId,
    string? Code,
    string? Stem,
    IReadOnlyList<string> Errors)
{
    public static AiGenerationItemDto Ok(int index, Domain.Catalog.Question question) => new(
        index,
        true,
        question.Id,
        question.Code,
        question.Stem,
        []);

    public static AiGenerationItemDto Failed(int index, string reason) => new(
        index,
        false,
        null,
        null,
        null,
        [reason]);

    public static AiGenerationItemDto Failed(int index, IReadOnlyList<string> reasons) => new(
        index,
        false,
        null,
        null,
        null,
        reasons);
}

/// <summary>一次生成的整体结果。</summary>
public sealed record AiGenerationResultDto(
    string Provider,
    string ProviderName,
    string Model,
    int Requested,
    int Succeeded,
    int Failed,
    IReadOnlyList<AiGenerationItemDto> Items);

/// <summary>生成过程中的一个事件。流式接口按顺序发出这些事件。</summary>
public abstract record AiGenerationEvent;

/// <summary>一道题已经落成候选题（草稿）。</summary>
/// <param name="Index">第几道（从 1 开始）。</param>
/// <param name="QuestionId">题目主键。</param>
/// <param name="Code">题号。</param>
/// <param name="Type">题型（存储值）。</param>
/// <param name="Stem">题干。</param>
/// <param name="Score">分值。</param>
public sealed record AiQuestionReadyEvent(
    int Index,
    long QuestionId,
    string Code,
    string Type,
    string Stem,
    decimal Score) : AiGenerationEvent;

/// <summary>一道题没通过校验（没落库），带原因。</summary>
public sealed record AiQuestionFailedEvent(int Index, string Error) : AiGenerationEvent;

/// <summary>整批生成结束。</summary>
public sealed record AiGenerationCompletedEvent(
    int Requested,
    int Succeeded,
    int Failed,
    string Provider,
    string ProviderName,
    string Model) : AiGenerationEvent;

/// <summary>流式接口里的一道题（一条 SSE 事件的载荷）。</summary>
public sealed record AiGenerationStreamItemDto(
    int Index,
    bool Succeeded,
    long? QuestionId,
    string? Code,
    string? Type,
    string? Stem,
    decimal? Score,
    IReadOnlyList<string> Errors);

/// <summary>
/// 流式接口里的错误事件载荷。
/// <para>
/// 流一开始就没法再改 HTTP 状态码（响应头早已发出），
/// 所以出错只能当作一条事件推给前端——否则前端看着像「生成完了」。
/// </para>
/// </summary>
/// <param name="ErrorCode">领域错误码（稳定契约）。</param>
/// <param name="Message">面向用户的中文说明。</param>
public sealed record AiGenerationStreamErrorDto(int ErrorCode, string Message);

/// <summary>流式接口的结束事件载荷。</summary>
public sealed record AiGenerationStreamDoneDto(
    int Requested,
    int Succeeded,
    int Failed,
    string Provider,
    string ProviderName,
    string Model);

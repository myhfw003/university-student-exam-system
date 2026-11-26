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

using Exam.Domain.Authoring;

namespace Exam.Application.Authoring.Contracts;

/// <summary>模板摘要。</summary>
public sealed record PaperTemplateSummaryDto(
    long Id,
    string Name,
    string Kind,
    string KindLabel,
    string VariantRule,
    string VariantRuleLabel,
    int DurationMinutes,
    decimal? PassScore,
    int ItemCount,
    decimal TotalScore,
    long? SourcePaperId,
    DateTimeOffset CreatedAt);

/// <summary>模板里的一道题。</summary>
public sealed record PaperTemplateItemDto(long QuestionId, decimal Score, int SortOrder);

/// <summary>模板详情。</summary>
public sealed record PaperTemplateDetailDto(
    PaperTemplateSummaryDto Template,
    IReadOnlyList<PaperTemplateItemDto> Items);

/// <summary>模板列表。</summary>
public sealed record PaperTemplateListResponse(
    IReadOnlyList<PaperTemplateSummaryDto> Items,
    int Total);

/// <summary>套用模板时被跳过的题目。</summary>
public sealed record TemplateSkippedItemDto(long QuestionId, string Code, string Reason);

/// <summary>套用模板的结果。</summary>
public sealed record TemplateApplyResponse(
    long TemplateId,
    long PaperId,
    int AppliedCount,
    int SkippedCount,
    decimal TotalScore,
    IReadOnlyList<TemplateSkippedItemDto> Skipped,
    PaperDetailDto Paper);

/// <summary>模板 DTO 组装。</summary>
public static class PaperTemplateDtoFactory
{
    public static PaperTemplateSummaryDto ToSummary(PaperTemplate template) => new(
        template.Id,
        template.Name,
        template.Kind.ToStorage(),
        template.Kind.Label(),
        template.VariantRule.ToStorage(),
        template.VariantRule.Label(),
        template.DurationMinutes,
        template.PassScore?.Value,
        template.Items.Count,
        template.TotalScore,
        template.SourcePaperId,
        template.CreatedAt);

    public static PaperTemplateDetailDto ToDetail(PaperTemplate template) => new(
        ToSummary(template),
        template.Items
            .OrderBy(i => i.SortOrder)
            .Select(i => new PaperTemplateItemDto(i.QuestionId, i.Score.Value, i.SortOrder))
            .ToList());
}

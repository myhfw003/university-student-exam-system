using Exam.Application.Authoring.Commands;

namespace Exam.Web.Api.Contracts;

public sealed record CreatePaperRequest(
    string Kind,
    string Name,
    string? Batch,
    string? Description,
    decimal TargetTotalScore,
    int DurationMinutes,
    decimal? PassScore,
    string? Note,
    IReadOnlyList<long>? TagIds,
    string? OrderRule,
    string? VariantRule,
    string? AnswerPolicy,
    bool AllowRetake,
    bool RetakeKeepsBest,
    ExamRulesDtoInput? ExamRules,
    PracticeRulesDtoInput? PracticeRules);

public sealed record UpdatePaperRequest(
    string Name,
    string? Batch,
    string? Description,
    decimal TargetTotalScore,
    int DurationMinutes,
    decimal? PassScore,
    string? Note,
    IReadOnlyList<long>? TagIds,
    string? OrderRule,
    string? VariantRule,
    string? AnswerPolicy,
    bool AllowRetake,
    bool RetakeKeepsBest,
    ExamRulesDtoInput? ExamRules,
    PracticeRulesDtoInput? PracticeRules);

public sealed record AddPaperItemRequest(long QuestionId, decimal Score, int? SortOrder);

public sealed record UpdatePaperItemRequest(decimal? Score, int? SortOrder);

public sealed record ReplacePaperItemsRequest(IReadOnlyList<PaperItemInput> Items);

public sealed record PublishPaperRequest(string? WarningOverrideReason);

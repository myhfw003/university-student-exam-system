using Exam.Domain.Catalog;

namespace Exam.Application.Catalog.Contracts;

/// <summary>客观题选项。</summary>
public sealed record QuestionOptionDto(string Key, string Text, bool IsCorrect);

/// <summary>简答评分要点。</summary>
public sealed record QuestionKeypointDto(string Text, IReadOnlyList<string> Keywords);

/// <summary>综合题评分步骤。</summary>
public sealed record QuestionStepDto(
    string Code,
    string Prompt,
    string? ReferenceAnswer,
    IReadOnlyList<string> Keywords,
    decimal Score);

/// <summary>题目附件。</summary>
public sealed record QuestionAttachmentDto(long Id, string FileName, string ContentType, long SizeBytes);

/// <summary>题目摘要。</summary>
public sealed record QuestionSummaryDto(
    long Id,
    string Code,
    string Type,
    string TypeLabel,
    string Stem,
    decimal DefaultScore,
    string Status,
    string StatusLabel,
    string Source,
    long DifficultyTagId,
    IReadOnlyList<long> TagIds,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt);

/// <summary>题目详情。</summary>
public sealed record QuestionDetailDto(
    QuestionSummaryDto Question,
    IReadOnlyList<QuestionOptionDto> Options,
    IReadOnlyList<QuestionKeypointDto> Keypoints,
    IReadOnlyList<QuestionStepDto> Steps,
    IReadOnlyList<QuestionAttachmentDto> Attachments,
    string? Analysis,
    string? ReferenceAnswer);

/// <summary>分页的题目列表。</summary>
public sealed record QuestionListResponse(
    IReadOnlyList<QuestionSummaryDto> Items,
    int Total,
    int Page,
    int Size);

/// <summary>批量状态变更的单条结果。</summary>
public sealed record BatchStatusItem(long QuestionId, bool Succeeded, string? Reason);

/// <summary>批量状态变更的结果。</summary>
public sealed record BatchStatusResult(int Total, int Succeeded, IReadOnlyList<BatchStatusItem> Items);

/// <summary>题库摘要。</summary>
public sealed record QuestionBankSummaryDto(long Id, string Name, string? Description, int QuestionCount);

/// <summary>题库详情，含题目清单与三态统计。</summary>
public sealed record QuestionBankDetailDto(
    QuestionBankSummaryDto Bank,
    IReadOnlyList<QuestionSummaryDto> Questions,
    QuestionBankStatistics Statistics);

/// <summary>题库统计：按状态与题型拆分。</summary>
public sealed record QuestionBankStatistics(
    int Total,
    int Draft,
    int Published,
    int Disabled,
    int ObjectiveCount,
    decimal ObjectiveScore,
    int SubjectiveCount,
    decimal SubjectiveScore);

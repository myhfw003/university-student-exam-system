using Exam.Domain.Authoring;

namespace Exam.Application.Authoring.Contracts;

/// <summary>试卷题位。</summary>
public sealed record PaperItemDto(long Id, long QuestionId, decimal Score, int SortOrder, long? SectionId);

/// <summary>试卷大题分组。</summary>
public sealed record PaperSectionDto(long Id, string Title, string? Instructions, int SortOrder);

/// <summary>试卷摘要。</summary>
public sealed record PaperSummaryDto(
    long Id,
    string Kind,
    string KindLabel,
    string Name,
    string? Batch,
    string? Description,
    string Status,
    string StatusLabel,
    decimal TargetTotalScore,
    decimal TotalItemScore,
    int DurationMinutes,
    decimal? PassScore,
    int ItemCount,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt);

/// <summary>考试卷规则。</summary>
public sealed record ExamRulesDto(
    int? MaxFocusLoss,
    string OnMaxFocusLoss,
    bool RequireFullScreen,
    bool BlockCopyPaste,
    bool BlockContextMenu,
    bool ShowWatermark,
    bool EnableHeartbeatCheck,
    int HeartbeatIntervalSeconds,
    int HeartbeatTimeoutSeconds,
    int MaxDisconnect,
    int EarlyEntryMinutes)
{
    public static ExamRulesDto From(ExamRules rules) => new(
        rules.MaxFocusLoss,
        rules.OnMaxFocusLoss,
        rules.RequireFullScreen,
        rules.BlockCopyPaste,
        rules.BlockContextMenu,
        rules.ShowWatermark,
        rules.EnableHeartbeatCheck,
        rules.HeartbeatIntervalSeconds,
        rules.HeartbeatTimeoutSeconds,
        rules.MaxDisconnect,
        rules.EarlyEntryMinutes);
}

/// <summary>练习卷规则。</summary>
public sealed record PracticeRulesDto(
    int MaxAttempts,
    string FeedbackTiming,
    bool ReflowMistakes,
    int SuggestedMinutes)
{
    public static PracticeRulesDto From(PracticeRules rules) => new(
        rules.MaxAttempts,
        rules.FeedbackTiming,
        rules.ReflowMistakes,
        rules.SuggestedMinutes);
}

/// <summary>试卷详情。</summary>
public sealed record PaperDetailDto(
    PaperSummaryDto Paper,
    IReadOnlyList<PaperItemDto> Items,
    IReadOnlyList<PaperSectionDto> Sections,
    IReadOnlyList<long> TagIds,
    string OrderRule,
    string VariantRule,
    string AnswerPolicy,
    bool AllowRetake,
    bool RetakeKeepsBest,
    string? Note,
    ExamRulesDto? ExamRules,
    PracticeRulesDto? PracticeRules,
    long? PublishedSnapshotId);

/// <summary>分页的试卷列表。</summary>
public sealed record PaperListResponse(
    IReadOnlyList<PaperSummaryDto> Items,
    int Total,
    int Page,
    int Size);

/// <summary>发布校验的一项。</summary>
public sealed record PaperValidationItemDto(
    string Key,
    string Label,
    bool Passed,
    string Severity,
    string? Detail,
    IReadOnlyList<long> Targets);

/// <summary>发布校验结果。</summary>
public sealed record PaperValidationResponse(
    IReadOnlyList<PaperValidationItemDto> Items,
    bool CanPublish,
    bool HasBlockingFailure);

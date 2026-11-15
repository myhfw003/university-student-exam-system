namespace Exam.Application.Learning.Contracts;

/// <summary>练习开放单摘要。</summary>
public sealed record PracticeSummaryDto(
    long Id,
    string Title,
    long PaperId,
    string PaperName,
    int QuestionCount,
    decimal TotalScore,
    IReadOnlyList<string> TagNames,
    int MaxAttempts,
    int UsedAttempts,
    int? RemainingAttempts,
    string FeedbackTiming,
    bool ReflowMistakes,
    int SuggestedMinutes,
    DateTimeOffset? OpenAt,
    DateTimeOffset? CloseAt,
    DateTimeOffset? PublishedAt,
    bool CanStart);

/// <summary>可见练习列表。</summary>
public sealed record PracticeListResponse(
    IReadOnlyList<PracticeSummaryDto> Items,
    int Total,
    int Page,
    int Size);

/// <summary>管理端的练习开放单。</summary>
public sealed record PracticeAssignmentDto(
    long Id,
    string Title,
    long PaperId,
    string PaperName,
    int QuestionCount,
    decimal TotalScore,
    string Status,
    string StatusLabel,
    IReadOnlyList<long> ScopeTagIds,
    IReadOnlyList<string> ScopeTagNames,
    DateTimeOffset? OpenAt,
    DateTimeOffset? CloseAt,
    DateTimeOffset? PublishedAt,
    DateTimeOffset CreatedAt,
    int AttemptCount);

/// <summary>管理端练习列表。</summary>
public sealed record PracticeAssignmentListResponse(
    IReadOnlyList<PracticeAssignmentDto> Items,
    int Total,
    int Page,
    int Size);

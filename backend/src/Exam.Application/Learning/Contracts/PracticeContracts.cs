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

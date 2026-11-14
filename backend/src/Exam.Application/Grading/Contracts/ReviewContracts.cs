namespace Exam.Application.Grading.Contracts;

/// <summary>阅卷任务。</summary>
public sealed record ReviewTaskDto(
    long Id,
    long AttemptId,
    int AttemptNo,
    string ExamName,
    long? ExamSessionId,
    long QuestionId,
    string QuestionCode,
    string QuestionType,
    string? StepCode,
    string AnswerText,
    decimal? SuggestedScore,
    decimal MaxScore,
    string Status,
    string StatusLabel,
    long? AssigneeId,
    long? ReviewerId,
    decimal? FinalScore,
    string? Comment,
    DateTimeOffset CreatedAt,
    DateTimeOffset? ReviewedAt);

/// <summary>阅卷任务列表。</summary>
public sealed record ReviewTaskListResponse(
    IReadOnlyList<ReviewTaskDto> Items,
    int Total,
    int Page,
    int Size);

/// <summary>阅卷任务计数。</summary>
public sealed record ReviewTaskCountDto(
    int Pending,
    int InReview,
    int Reviewed,
    int Mine);

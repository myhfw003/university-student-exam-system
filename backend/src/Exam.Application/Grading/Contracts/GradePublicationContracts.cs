namespace Exam.Application.Grading.Contracts;

/// <summary>一次成绩发布。</summary>
public sealed record GradePublicationDto(
    long Id,
    long ExamSessionId,
    string Scope,
    string ScopeLabel,
    DateTimeOffset PublishedAt,
    long PublishedBy,
    IReadOnlyList<long> IncludedAttemptIds,
    int AffectedAttempts);

/// <summary>场次成绩列表里的一条。</summary>
public sealed record ExamSessionGradeDto(
    long AttemptId,
    int AttemptNo,
    long UserId,
    string StudentUsername,
    string StudentDisplayName,
    decimal ObjectiveScore,
    decimal ObjectiveMax,
    decimal TotalScore,
    decimal TotalMax,
    bool SubjectivePending,
    string GradeVisibility,
    bool Published,
    DateTimeOffset? SubmittedAt);

/// <summary>场次成绩列表。</summary>
public sealed record ExamSessionGradeListResponse(
    long ExamSessionId,
    string ExamName,
    IReadOnlyList<ExamSessionGradeDto> Items,
    int Total,
    int PublishedCount);

namespace Exam.Application.Learning.Contracts;

/// <summary>错题本里的一条。</summary>
public sealed record MistakeDto(
    long Id,
    long QuestionId,
    string QuestionCode,
    string QuestionType,
    string QuestionTypeLabel,
    string Stem,
    IReadOnlyList<string> TagNames,
    int WrongCount,
    string Reason,
    string ReasonLabel,
    string SourceType,
    string SourceTypeLabel,
    DateTimeOffset LastWrongAt,
    DateTimeOffset? ResolvedAt,
    long? SourceAttemptId);

/// <summary>单题重做的结果。</summary>
public sealed record RedoMistakeResponse(
    long PracticeAssignmentId,
    long AttemptId,
    long QuestionId,
    string QuestionCode,
    string QuestionType,
    string Title,
    DateTimeOffset DeadlineAt);

/// <summary>错题本列表。</summary>
public sealed record MistakeListResponse(
    IReadOnlyList<MistakeDto> Items,
    int Total,
    int Page,
    int Size);

using Exam.Domain.Delivery;

namespace Exam.Application.Delivery.Contracts;

/// <summary>成绩报告里的一道题。</summary>
public sealed record ExamReportDetailDto(
    long QuestionId,
    long PaperItemId,
    string QuestionCode,
    string Type,
    string TypeLabel,
    string Stem,
    AnswerPayload? YourAnswer,
    IReadOnlyList<string> CorrectKeys,
    string? ReferenceAnswer,
    string? Analysis,
    decimal? Score,
    decimal MaxScore,
    bool Revealed);

/// <summary>
/// 成绩报告。
/// <para>
/// 正确答案与解析受答案公布策略约束：没到公布时机，答案与解析一律不给。
/// </para>
/// </summary>
public sealed record ExamReportDto(
    long AttemptId,
    int AttemptNo,
    string? ExamName,
    DateTimeOffset? SubmittedAt,
    decimal ObjectiveScore,
    decimal ObjectiveMax,
    decimal? SubjectiveScore,
    decimal SubjectiveMax,
    decimal TotalScore,
    decimal TotalMax,
    string Status,
    bool AnswersRevealed,
    string AnswerPolicy,
    IReadOnlyList<ExamReportDetailDto> Details);

/// <summary>我的成绩列表里的一条。</summary>
public sealed record MyResultDto(
    long AttemptId,
    string? ExamName,
    int AttemptNo,
    DateTimeOffset? SubmittedAt,
    decimal TotalScore,
    decimal TotalMax,
    bool SubjectivePending,
    string Status);

/// <summary>我的成绩列表。</summary>
public sealed record MyResultListResponse(
    IReadOnlyList<MyResultDto> Items,
    int Total);

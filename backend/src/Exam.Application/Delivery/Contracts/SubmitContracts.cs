namespace Exam.Application.Delivery.Contracts;

/// <summary>交卷结果。</summary>
public sealed record SubmitAttemptResponse(
    long AttemptId,
    string Status,
    string StatusLabel,
    DateTimeOffset? SubmittedAt,
    string SubmitReason,
    string SubmitReasonLabel,
    decimal? ObjectiveScore,
    decimal? ObjectiveMax,
    bool SubjectivePending,
    decimal? TotalScore,
    decimal? TotalMax,
    string GradeVisibility);

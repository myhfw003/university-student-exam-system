using Exam.Domain.Grading;

namespace Exam.Application.Delivery.Contracts;

/// <summary>一道题的评分结果。</summary>
public sealed record ScoreResultDto(
    long QuestionId,
    decimal Score,
    decimal MaxScore,
    string Method,
    string MethodLabel,
    string Status,
    string StatusLabel,
    long? ScoredBy,
    DateTimeOffset? ScoredAt,
    IReadOnlyList<string> HitItems,
    IReadOnlyList<string> MissedItems,
    IReadOnlyList<string> Notes);

/// <summary>一次作答的成绩汇总。</summary>
public sealed record AttemptScoreSummaryDto(
    decimal ObjectiveScore,
    decimal ObjectiveMax,
    bool SubjectivePending,
    decimal TotalScore,
    decimal TotalMax,
    string GradeVisibility,
    IReadOnlyList<ScoreResultDto> Items);

/// <summary>成绩可见性。</summary>
public static class GradeVisibilities
{
    /// <summary>完全不可见。</summary>
    public const string Hidden = "hidden";

    /// <summary>只可见客观题得分。</summary>
    public const string ObjectiveOnly = "objective_only";

    /// <summary>可见客观题得分，主观题待阅。</summary>
    public const string PendingReview = "pending_review";

    /// <summary>成绩已发布。</summary>
    public const string Published = "published";
}

/// <summary>成绩汇总组装。</summary>
public static class AttemptScoreSummaryFactory
{
    /// <summary>
    /// 汇总一次作答的成绩。
    /// <para>
    /// 客观题（自动评分）计入客观分；主观题的建议分计入总分但同时标记「待阅」。
    /// </para>
    /// </summary>
    public static AttemptScoreSummaryDto Build(IReadOnlyList<Domain.Grading.ScoreResult> results)
    {
        var items = results
            .OrderBy(r => r.QuestionId)
            .Select(r => new ScoreResultDto(
                r.QuestionId,
                r.Score.Value,
                r.MaxScore.Value,
                r.Method.ToStorage(),
                r.Method.Label(),
                r.Status.ToStorage(),
                r.Status.Label(),
                r.ScoredBy,
                r.ScoredAt,
                r.Detail.HitItems,
                r.Detail.MissedItems,
                r.Detail.Notes))
            .ToList();

        var objective = results
            .Where(r => r.Method == Domain.Grading.ScoringMethod.AutoScored)
            .ToList();

        var objectiveScore = objective.Sum(r => r.Score.Value);
        var objectiveMax = objective.Sum(r => r.MaxScore.Value);

        var totalScore = results.Sum(r => r.Score.Value);
        var totalMax = results.Sum(r => r.MaxScore.Value);

        // 主观题还没定分时，成绩只能算「待阅」。
        var subjectivePending = results.Any(r =>
            r.Method == Domain.Grading.ScoringMethod.AutoSuggested
            || r.Status == Domain.Grading.ScoringStatus.Pending);

        var visibility = subjectivePending
            ? GradeVisibilities.PendingReview
            : GradeVisibilities.ObjectiveOnly;

        return new AttemptScoreSummaryDto(
            objectiveScore,
            objectiveMax,
            subjectivePending,
            totalScore,
            totalMax,
            visibility,
            items);
    }
}

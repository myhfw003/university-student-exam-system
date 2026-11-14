using Exam.Domain.Catalog;
using Exam.Domain.SharedKernel.Entities;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Grading;

/// <summary>评分明细：命中项、漏选项与其它说明。</summary>
public sealed record ScoringDetail(
    IReadOnlyList<string> HitItems,
    IReadOnlyList<string> MissedItems,
    IReadOnlyList<string> Notes)
{
    public static ScoringDetail Empty { get; } = new([], [], []);
}

/// <summary>
/// 一道题的评分结果。
/// <para>
/// 客观题交卷即定分；主观题先给建议分，人工确认后才变成最终分。
/// 每次改分都会追加一条 `grade_revision` 流水，这里只保留当前值。
/// </para>
/// </summary>
public sealed class ScoreResult : AuditableEntity, IAuditedEntity
{
    private ScoreResult()
    {
    }

    private ScoreResult(
        long attemptId,
        long questionId,
        long? paperItemId,
        Score score,
        Score maxScore,
        ScoringMethod method,
        ScoringStatus status,
        ScoringDetail detail,
        DateTimeOffset now,
        long? actorId)
        : base(now, actorId)
    {
        AttemptId = attemptId;
        QuestionId = questionId;
        PaperItemId = paperItemId;
        Score = score;
        MaxScore = maxScore;
        Method = method;
        Status = status;
        Detail = detail;
        ScoredAt = now;
    }

    public long AttemptId { get; private set; }

    public long QuestionId { get; private set; }

    public long? PaperItemId { get; private set; }

    /// <summary>得分。</summary>
    public Score Score { get; private set; } = Score.Zero;

    /// <summary>满分。</summary>
    public Score MaxScore { get; private set; } = Score.Zero;

    /// <summary>评分方式。</summary>
    public ScoringMethod Method { get; private set; }

    /// <summary>评分状态。</summary>
    public ScoringStatus Status { get; private set; }

    /// <summary>评分明细。</summary>
    public ScoringDetail Detail { get; private set; } = ScoringDetail.Empty;

    /// <summary>人工评分人。</summary>
    public long? ScoredBy { get; private set; }

    /// <summary>评分时间。</summary>
    public DateTimeOffset? ScoredAt { get; private set; }

    /// <summary>由判分结果创建。</summary>
    public static ScoreResult FromOutcome(
        long attemptId,
        long questionId,
        long? paperItemId,
        ScoringOutcome outcome,
        DateTimeOffset now,
        long? actorId = null)
    {
        var maxScore = Score.Paper(outcome.MaxScore);
        var score = Score.Graded(outcome.Score, maxScore.Value);

        return new ScoreResult(
            attemptId,
            questionId,
            paperItemId,
            score,
            maxScore,
            outcome.Method,
            outcome.Status,
            BuildDetail(outcome.Details),
            now,
            actorId);
    }

    /// <summary>人工评分。分数必须在 0..满分之间，且以 0.5 为步进。</summary>
    public void ApplyManualScore(decimal score, long reviewerId, DateTimeOffset now)
    {
        if (score < 0m || score > MaxScore.Value)
        {
            throw new BusinessRuleException($"分数必须在 0 到 {MaxScore.Value} 之间。");
        }

        Score = Score.Graded(score, MaxScore.Value);
        Method = ScoringMethod.ManualScored;
        Status = ScoringStatus.Final;
        ScoredBy = reviewerId;
        ScoredAt = now;
        Touch(now, reviewerId);
    }

    /// <summary>
    /// 写入人工得分，但**不定分**。
    /// <para>
    /// 综合题按步骤拆分阅卷：一步评完只更新当前总分，全部步骤评完才定分。
    /// </para>
    /// </summary>
    public void ApplyPartialManualScore(decimal score, long reviewerId, DateTimeOffset now)
    {
        if (score < 0m || score > MaxScore.Value)
        {
            throw new BusinessRuleException($"分数必须在 0 到 {MaxScore.Value} 之间。");
        }

        Score = Score.Graded(score, MaxScore.Value);
        Method = ScoringMethod.ManualScored;
        Status = ScoringStatus.Suggested;
        ScoredBy = reviewerId;
        ScoredAt = now;
        Touch(now, reviewerId);
    }

    /// <summary>采纳系统建议分，转为最终分。</summary>
    public void AdoptSuggestion(long reviewerId, DateTimeOffset now)
    {
        Score = Score.Graded(Score.Value, MaxScore.Value);
        Method = ScoringMethod.ManualScored;
        Status = ScoringStatus.Final;
        ScoredBy = reviewerId;
        ScoredAt = now;
        Touch(now, reviewerId);
    }

    /// <summary>按判分明细拆分命中与漏选。</summary>
    private static ScoringDetail BuildDetail(IReadOnlyList<string> details)
    {
        var hit = new List<string>();
        var missed = new List<string>();
        var notes = new List<string>();

        foreach (var detail in details)
        {
            if (detail.StartsWith('✓'))
            {
                hit.Add(detail.TrimStart('✓', ' '));
            }
            else if (detail.StartsWith('○'))
            {
                missed.Add(detail.TrimStart('○', ' '));
            }
            else
            {
                notes.Add(detail);
            }
        }

        return new ScoringDetail(hit, missed, notes);
    }
}

public static class ScoringMethods
{
    public static string ToStorage(this ScoringMethod method) => method switch
    {
        ScoringMethod.AutoSuggested => "auto_suggested",
        ScoringMethod.ManualScored => "manual_scored",
        _ => "auto_scored",
    };

    public static ScoringMethod? FromStorage(string? storage) => storage switch
    {
        "auto_scored" => ScoringMethod.AutoScored,
        "auto_suggested" => ScoringMethod.AutoSuggested,
        "manual_scored" => ScoringMethod.ManualScored,
        _ => null,
    };

    public static string Label(this ScoringMethod method) => method switch
    {
        ScoringMethod.AutoSuggested => "系统建议",
        ScoringMethod.ManualScored => "人工评分",
        _ => "自动评分",
    };
}

public static class ScoringStatuses
{
    public static string ToStorage(this ScoringStatus status) => status switch
    {
        ScoringStatus.AutoScored => "auto_scored",
        ScoringStatus.Suggested => "suggested",
        ScoringStatus.Final => "final",
        _ => "pending",
    };

    public static ScoringStatus? FromStorage(string? storage) => storage switch
    {
        "pending" => ScoringStatus.Pending,
        "auto_scored" => ScoringStatus.AutoScored,
        "suggested" => ScoringStatus.Suggested,
        "final" => ScoringStatus.Final,
        _ => null,
    };

    public static string Label(this ScoringStatus status) => status switch
    {
        ScoringStatus.AutoScored => "已自动评分",
        ScoringStatus.Suggested => "待确认",
        ScoringStatus.Final => "已定分",
        _ => "待阅",
    };
}

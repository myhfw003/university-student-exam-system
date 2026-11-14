using Exam.Domain.Catalog;
using Exam.Domain.SharedKernel.Entities;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Grading;

/// <summary>阅卷任务状态。</summary>
public enum ReviewTaskStatus
{
    /// <summary>待领取。</summary>
    Pending,

    /// <summary>阅卷中。</summary>
    InReview,

    /// <summary>已阅完。</summary>
    Reviewed,
}

/// <summary>
/// 阅卷任务。一份主观题作答拆成一条（或多条）待阅任务。
/// <para>综合题按步骤拆开：一步一条，阅卷人只判这一步。</para>
/// </summary>
public sealed class ReviewTask : AuditableEntity, IAuditedEntity
{
    private ReviewTask()
    {
    }

    private ReviewTask(
        long attemptId,
        long? examSessionId,
        long questionId,
        string? stepCode,
        string answerText,
        Score? suggestedScore,
        Score maxScore,
        DateTimeOffset now)
        : base(now, null)
    {
        AttemptId = attemptId;
        ExamSessionId = examSessionId;
        QuestionId = questionId;
        StepCode = stepCode;
        AnswerText = answerText;
        SuggestedScore = suggestedScore;
        MaxScore = maxScore;
        Status = ReviewTaskStatus.Pending;
    }

    public long AttemptId { get; private set; }

    public long? ExamSessionId { get; private set; }

    public long QuestionId { get; private set; }

    /// <summary>综合题的步骤码。普通题目为空。</summary>
    public string? StepCode { get; private set; }

    /// <summary>作答原文。</summary>
    public string AnswerText { get; private set; } = string.Empty;

    /// <summary>系统建议分。</summary>
    public Score? SuggestedScore { get; private set; }

    /// <summary>本任务满分。</summary>
    public Score MaxScore { get; private set; } = Score.Zero;

    public ReviewTaskStatus Status { get; private set; }

    /// <summary>指派给谁。为空表示待领取。</summary>
    public long? AssigneeId { get; private set; }

    /// <summary>实际阅卷人。</summary>
    public long? ReviewerId { get; private set; }

    /// <summary>最终得分。</summary>
    public Score? FinalScore { get; private set; }

    /// <summary>评语。学生可见。</summary>
    public string? Comment { get; private set; }

    public DateTimeOffset? ReviewedAt { get; private set; }

    public static ReviewTask Create(
        long attemptId,
        long? examSessionId,
        long questionId,
        string? stepCode,
        string answerText,
        Score? suggestedScore,
        Score maxScore,
        DateTimeOffset now) =>
        new(attemptId, examSessionId, questionId, stepCode, answerText, suggestedScore, maxScore, now);

    /// <summary>领取任务。先到先得：已被领取就失败。</summary>
    public void Claim(long reviewerId, DateTimeOffset now)
    {
        if (Status != ReviewTaskStatus.Pending)
        {
            throw new BusinessRuleException("该任务已被领取或已阅完。");
        }

        Status = ReviewTaskStatus.InReview;
        ReviewerId = reviewerId;
        AssigneeId = reviewerId;
        Touch(now, reviewerId);
    }

    /// <summary>指派给指定阅卷人。</summary>
    public void Assign(long userId, DateTimeOffset now)
    {
        if (Status == ReviewTaskStatus.Reviewed)
        {
            throw new BusinessRuleException("已阅完的任务不能再指派。");
        }

        AssigneeId = userId;
        Status = ReviewTaskStatus.InReview;
        Touch(now, userId);
    }

    /// <summary>评分并写评语。</summary>
    public void Grade(Score score, string? comment, long reviewerId, DateTimeOffset now)
    {
        if (score.Value < 0m || score.Value > MaxScore.Value)
        {
            throw new BusinessRuleException($"分数必须在 0 到 {MaxScore.Value} 之间。");
        }

        Status = ReviewTaskStatus.Reviewed;
        ReviewerId = reviewerId;
        FinalScore = score;
        Comment = string.IsNullOrWhiteSpace(comment) ? null : comment.Trim();
        ReviewedAt = now;
        Touch(now, reviewerId);
    }

    /// <summary>采纳系统建议分。</summary>
    public void AdoptSuggestion(long reviewerId, DateTimeOffset now)
    {
        var score = SuggestedScore ?? Score.Zero;
        Grade(score, Comment, reviewerId, now);
    }
}

public static class ReviewTaskStatuses
{
    public static string ToStorage(this ReviewTaskStatus status) => status switch
    {
        ReviewTaskStatus.InReview => "in_review",
        ReviewTaskStatus.Reviewed => "reviewed",
        _ => "pending",
    };

    public static ReviewTaskStatus? FromStorage(string? storage) => storage switch
    {
        "pending" => ReviewTaskStatus.Pending,
        "in_review" => ReviewTaskStatus.InReview,
        "reviewed" => ReviewTaskStatus.Reviewed,
        _ => null,
    };

    public static string Label(this ReviewTaskStatus status) => status switch
    {
        ReviewTaskStatus.InReview => "阅卷中",
        ReviewTaskStatus.Reviewed => "已阅完",
        _ => "待领取",
    };
}

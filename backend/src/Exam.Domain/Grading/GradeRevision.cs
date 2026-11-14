using Exam.Domain.SharedKernel.Entities;

namespace Exam.Domain.Grading;

/// <summary>
/// 改分流水。**追加式**：只追加，不修改、不删除。
/// <para>
/// 每次人工评分或改分都留下一条：改前多少分、改后多少分、谁改的、什么时候改的。
/// 教师私自改分赖不掉——流水与审计日志一起作证，学生端也能看到改分记录。
/// 应用账号对该表没有 UPDATE / DELETE 权限。
/// </para>
/// </summary>
public sealed class GradeRevision : Entity<long>
{
    private GradeRevision()
    {
    }

    private GradeRevision(
        long scoreResultId,
        decimal? previousScore,
        decimal newScore,
        string? comment,
        long operatorId,
        DateTimeOffset occurredAt)
    {
        ScoreResultId = scoreResultId;
        PreviousScore = previousScore;
        NewScore = newScore;
        Comment = comment;
        OperatorId = operatorId;
        OccurredAt = occurredAt;
    }

    /// <summary>对应的评分结果（一次作答里的一道题）。</summary>
    public long ScoreResultId { get; private set; }

    /// <summary>
    /// 改分前的得分。首次人工评分时是系统建议分；此前没有任何评分记录时为空。
    /// </summary>
    public decimal? PreviousScore { get; private set; }

    /// <summary>改分后的得分。</summary>
    public decimal NewScore { get; private set; }

    /// <summary>评语。学生端可见。</summary>
    public string? Comment { get; private set; }

    /// <summary>阅卷人。</summary>
    public long OperatorId { get; private set; }

    /// <summary>改分时间。</summary>
    public DateTimeOffset OccurredAt { get; private set; }

    public static GradeRevision Create(
        long scoreResultId,
        decimal? previousScore,
        decimal newScore,
        string? comment,
        long operatorId,
        DateTimeOffset occurredAt) =>
        new(
            scoreResultId,
            previousScore,
            newScore,
            string.IsNullOrWhiteSpace(comment) ? null : comment.Trim(),
            operatorId,
            occurredAt);
}

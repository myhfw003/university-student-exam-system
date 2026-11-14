using Exam.Domain.SharedKernel.Entities;

namespace Exam.Domain.Delivery;

/// <summary>考生在名单中的状态。</summary>
public enum ParticipantStatus
{
    /// <summary>已纳入名单，尚未进入。</summary>
    Invited,

    /// <summary>已进入但未开始作答。</summary>
    NotStarted,

    /// <summary>作答中。</summary>
    InProgress,

    /// <summary>已交卷。</summary>
    Submitted,

    /// <summary>缺考。</summary>
    Absent,

    /// <summary>被取消资格。</summary>
    Disqualified,
}

/// <summary>
/// 考试名单项。名单在场次发布时物化，之后与标签解耦——
/// 标签改了也不影响这一场已经定下来的名单。
/// </summary>
public sealed class ExamParticipant : Entity<long>, IAuditedEntity
{
    private ExamParticipant()
    {
    }

    private ExamParticipant(long examSessionId, long userId, DateTimeOffset now)
    {
        ExamSessionId = examSessionId;
        UserId = userId;
        Status = ParticipantStatus.Invited;
        CreatedAt = now;
    }

    public long ExamSessionId { get; private set; }

    public long UserId { get; private set; }

    public ParticipantStatus Status { get; private set; }

    /// <summary>已用尝试次数。</summary>
    public int AttemptsUsed { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset? UpdatedAt { get; private set; }

    public static ExamParticipant Create(long examSessionId, long userId, DateTimeOffset now) =>
        new(examSessionId, userId, now);

    /// <summary>考生已进入。</summary>
    public void MarkNotStarted(DateTimeOffset now)
    {
        if (Status is ParticipantStatus.Submitted or ParticipantStatus.Disqualified)
        {
            return;
        }

        Status = ParticipantStatus.NotStarted;
        UpdatedAt = now;
    }

    /// <summary>考生开始作答。</summary>
    public void MarkInProgress(DateTimeOffset now)
    {
        if (Status is ParticipantStatus.Submitted or ParticipantStatus.Disqualified)
        {
            return;
        }

        Status = ParticipantStatus.InProgress;
        UpdatedAt = now;
    }

    /// <summary>考生已交卷。</summary>
    public void MarkSubmitted(DateTimeOffset now)
    {
        Status = ParticipantStatus.Submitted;
        UpdatedAt = now;
    }

    /// <summary>标记缺考。</summary>
    public void MarkAbsent(DateTimeOffset now)
    {
        if (Status == ParticipantStatus.Submitted)
        {
            return;
        }

        Status = ParticipantStatus.Absent;
        UpdatedAt = now;
    }

    /// <summary>取消资格。</summary>
    public void Disqualify(DateTimeOffset now)
    {
        Status = ParticipantStatus.Disqualified;
        UpdatedAt = now;
    }

    /// <summary>记一次尝试。返回是否还能继续重考。</summary>
    public bool UseAttempt(int maxAttempts)
    {
        AttemptsUsed++;
        UpdatedAt = DateTimeOffset.UtcNow;
        return maxAttempts <= 0 || AttemptsUsed < maxAttempts;
    }
}

public static class ParticipantStatuses
{
    public static string ToStorage(this ParticipantStatus status) => status switch
    {
        ParticipantStatus.NotStarted => "not_started",
        ParticipantStatus.InProgress => "in_progress",
        ParticipantStatus.Submitted => "submitted",
        ParticipantStatus.Absent => "absent",
        ParticipantStatus.Disqualified => "disqualified",
        _ => "invited",
    };

    public static ParticipantStatus? FromStorage(string? storage) => storage switch
    {
        "invited" => ParticipantStatus.Invited,
        "not_started" => ParticipantStatus.NotStarted,
        "in_progress" => ParticipantStatus.InProgress,
        "submitted" => ParticipantStatus.Submitted,
        "absent" => ParticipantStatus.Absent,
        "disqualified" => ParticipantStatus.Disqualified,
        _ => null,
    };

    public static string Label(this ParticipantStatus status) => status switch
    {
        ParticipantStatus.NotStarted => "未开始",
        ParticipantStatus.InProgress => "作答中",
        ParticipantStatus.Submitted => "已交卷",
        ParticipantStatus.Absent => "缺考",
        ParticipantStatus.Disqualified => "已取消资格",
        _ => "待入场",
    };
}

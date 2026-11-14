using Exam.Domain.SharedKernel.Entities;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Delivery;

/// <summary>作答目标类型。</summary>
public enum AttemptTargetType
{
    /// <summary>考试。</summary>
    Exam,

    /// <summary>练习。</summary>
    Practice,
}

/// <summary>作答会话状态。</summary>
public enum AttemptStatus
{
    NotStarted,
    InProgress,
    Submitted,
    AutoSubmitted,
    ForceSubmitted,
    Abandoned,
}

/// <summary>交卷原因。</summary>
public enum SubmitReason
{
    /// <summary>考生主动交卷。</summary>
    Manual,

    /// <summary>超时自动交卷。</summary>
    TimeUp,

    /// <summary>监考强制交卷。</summary>
    ProctorForce,

    /// <summary>管理员强制交卷。</summary>
    AdminForce,

    /// <summary>断网超时代交。</summary>
    NetworkTimeout,
}

/// <summary>
/// 作答会话聚合根。一次考试的一次尝试。
/// <para>
/// **截止时间由服务端算**：客户端改本机时间没有任何用。
/// 断线重进拿到的是同一个会话（幂等），不会多出一次尝试。
/// </para>
/// </summary>
public sealed class Attempt : AuditableEntity, IAuditedEntity
{
    private Attempt()
    {
    }

    private Attempt(
        AttemptTargetType targetType,
        long? examSessionId,
        long? practiceAssignmentId,
        long userId,
        int attemptNo,
        string? variantKey,
        string? variantSeed,
        DateTimeOffset now,
        long? actorId)
        : base(now, actorId)
    {
        TargetType = targetType;
        ExamSessionId = examSessionId;
        PracticeAssignmentId = practiceAssignmentId;
        UserId = userId;
        AttemptNo = attemptNo;
        VariantKey = variantKey;
        VariantSeed = variantSeed;
        Status = AttemptStatus.NotStarted;
    }

    public AttemptTargetType TargetType { get; private set; }

    public long? ExamSessionId { get; private set; }

    public long? PracticeAssignmentId { get; private set; }

    public long UserId { get; private set; }

    /// <summary>第几次尝试，从 1 开始。</summary>
    public int AttemptNo { get; private set; }

    public AttemptStatus Status { get; private set; }

    /// <summary>服务端开始时间。</summary>
    public DateTimeOffset? StartedAt { get; private set; }

    /// <summary>服务端计算的截止时间。</summary>
    public DateTimeOffset DeadlineAt { get; private set; }

    public DateTimeOffset? SubmittedAt { get; private set; }

    /// <summary>交卷原因。</summary>
    public SubmitReason? SubmitReason { get; private set; }

    /// <summary>服务端最近一次接受保存的时间。</summary>
    public DateTimeOffset? LastSavedAt { get; private set; }

    /// <summary>服务端已接收的最大客户端序列号。</summary>
    public int LastClientSeq { get; private set; }

    /// <summary>切屏计数（服务端权威）。</summary>
    public int FocusLossCount { get; private set; }

    /// <summary>断连计数。</summary>
    public int DisconnectCount { get; private set; }

    /// <summary>警告计数。</summary>
    public int WarningCount { get; private set; }

    /// <summary>本次卷面标识。</summary>
    public string? VariantKey { get; private set; }

    /// <summary>卷面派生种子。</summary>
    public string? VariantSeed { get; private set; }

    /// <summary>实际用时（秒）。</summary>
    public int? DurationSpentSeconds { get; private set; }

    /// <summary>是否已交卷。</summary>
    public bool IsSubmitted => Status is AttemptStatus.Submitted
        or AttemptStatus.AutoSubmitted
        or AttemptStatus.ForceSubmitted;

    public static Attempt CreateExam(
        long examSessionId,
        long userId,
        int attemptNo,
        string? variantKey,
        string? variantSeed,
        DateTimeOffset now,
        long? actorId = null) =>
        new(AttemptTargetType.Exam, examSessionId, null, userId, attemptNo, variantKey, variantSeed, now, actorId);

    public static Attempt CreatePractice(
        long practiceAssignmentId,
        long userId,
        int attemptNo,
        string? variantKey,
        string? variantSeed,
        DateTimeOffset now,
        long? actorId = null) =>
        new(AttemptTargetType.Practice, null, practiceAssignmentId, userId, attemptNo, variantKey, variantSeed, now, actorId);

    /// <summary>
    /// 开始作答。状态推进的同时定下截止时间：
    /// 取「开始时间 + 作答时长」与「场次关闭时间」中较早的一个。
    /// </summary>
    public void Start(DateTimeOffset now, int durationMinutes, DateTimeOffset sessionCloseAt)
    {
        if (Status != AttemptStatus.NotStarted)
        {
            throw new InvalidStateTransitionException("只有尚未开始的会话才能开始作答。");
        }

        if (durationMinutes <= 0)
        {
            throw new BusinessRuleException("作答时长必须大于 0 分钟。");
        }

        StartedAt = now;
        DeadlineAt = now.AddMinutes(durationMinutes) < sessionCloseAt
            ? now.AddMinutes(durationMinutes)
            : sessionCloseAt;
        Status = AttemptStatus.InProgress;
        Touch(now, UserId);
    }

    /// <summary>校验此刻还能不能保存答案。</summary>
    public void EnsureAcceptingAnswers(DateTimeOffset now)
    {
        if (IsSubmitted)
        {
            throw new AttemptStateInvalidException("会话已交卷，不能再保存答案。");
        }

        if (Status != AttemptStatus.InProgress)
        {
            throw new AttemptStateInvalidException("会话尚未开始，不能保存答案。");
        }

        if (now > DeadlineAt)
        {
            throw new AttemptDeadlineExceededException("已超过截止时间，请立即交卷。");
        }
    }

    /// <summary>
    /// 接受一次保存。返回 false 表示这是重放，直接忽略。
    /// </summary>
    public bool AcceptSave(int clientSeq, DateTimeOffset now)
    {
        if (clientSeq <= LastClientSeq)
        {
            return false;
        }

        LastClientSeq = clientSeq;
        LastSavedAt = now;
        Touch(now, UserId);
        return true;
    }

    /// <summary>切屏计数 +1。</summary>
    public int RecordFocusLoss(DateTimeOffset now)
    {
        FocusLossCount++;
        Touch(now, UserId);
        return FocusLossCount;
    }

    /// <summary>断连计数 +1。</summary>
    public int RecordDisconnect(DateTimeOffset now)
    {
        DisconnectCount++;
        Touch(now, UserId);
        return DisconnectCount;
    }

    /// <summary>警告计数 +1。</summary>
    public int RecordWarning(DateTimeOffset now)
    {
        WarningCount++;
        Touch(now, UserId);
        return WarningCount;
    }

    /// <summary>
    /// 交卷。幂等：已交卷直接返回 false，不重复推进状态。
    /// </summary>
    public bool Submit(SubmitReason reason, DateTimeOffset now)
    {
        if (IsSubmitted)
        {
            return false;
        }

        Status = reason switch
        {
            Exam.Domain.Delivery.SubmitReason.TimeUp => AttemptStatus.AutoSubmitted,
            Exam.Domain.Delivery.SubmitReason.ProctorForce
                or Exam.Domain.Delivery.SubmitReason.AdminForce => AttemptStatus.ForceSubmitted,
            _ => AttemptStatus.Submitted,
        };

        SubmitReason = reason;
        SubmittedAt = now;
        DurationSpentSeconds = StartedAt is null
            ? null
            : (int)Math.Max(0, Math.Round((now - StartedAt.Value).TotalSeconds));
        Touch(now, UserId);
        return true;
    }

    /// <summary>标记为放弃（超时未交且被清理）。</summary>
    public void Abandon(DateTimeOffset now)
    {
        if (IsSubmitted)
        {
            return;
        }

        Status = AttemptStatus.Abandoned;
        SubmittedAt = now;
        SubmitReason = Exam.Domain.Delivery.SubmitReason.TimeUp;
        Touch(now, UserId);
    }

    /// <summary>校验会话可以恢复。</summary>
    public void EnsureResumable(DateTimeOffset now)
    {
        if (IsSubmitted)
        {
            throw new AttemptStateInvalidException("会话已交卷，不能继续作答。");
        }

        if (Status == AttemptStatus.Abandoned)
        {
            throw new AttemptStateInvalidException("会话已结束，不能继续作答。");
        }

        if (now > DeadlineAt)
        {
            throw new AttemptDeadlineExceededException("已超过截止时间，请立即交卷。");
        }
    }

    /// <summary>剩余秒数。</summary>
    public long RemainingSeconds(DateTimeOffset now)
    {
        var remaining = (DeadlineAt - now).TotalSeconds;
        return remaining > 0 ? (long)Math.Floor(remaining) : 0;
    }
}

/// <summary>作答会话状态非法。</summary>
public sealed class AttemptStateInvalidException : DomainException
{
    public AttemptStateInvalidException(string message)
        : base(message, ErrorCodes.AttemptStateInvalid) { }
}

/// <summary>已超过截止时间。</summary>
public sealed class AttemptDeadlineExceededException : DomainException
{
    public AttemptDeadlineExceededException(string message)
        : base(message, ErrorCodes.AttemptDeadlineExceeded) { }
}

public static class AttemptTargetTypes
{
    public static string ToStorage(this AttemptTargetType type) => type == AttemptTargetType.Practice ? "practice" : "exam";

    public static AttemptTargetType? FromStorage(string? storage) => storage switch
    {
        "exam" => AttemptTargetType.Exam,
        "practice" => AttemptTargetType.Practice,
        _ => null,
    };
}

public static class AttemptStatuses
{
    public static string ToStorage(this AttemptStatus status) => status switch
    {
        AttemptStatus.InProgress => "in_progress",
        AttemptStatus.Submitted => "submitted",
        AttemptStatus.AutoSubmitted => "auto_submitted",
        AttemptStatus.ForceSubmitted => "force_submitted",
        AttemptStatus.Abandoned => "abandoned",
        _ => "not_started",
    };

    public static AttemptStatus? FromStorage(string? storage) => storage switch
    {
        "not_started" => AttemptStatus.NotStarted,
        "in_progress" => AttemptStatus.InProgress,
        "submitted" => AttemptStatus.Submitted,
        "auto_submitted" => AttemptStatus.AutoSubmitted,
        "force_submitted" => AttemptStatus.ForceSubmitted,
        "abandoned" => AttemptStatus.Abandoned,
        _ => null,
    };

    public static string Label(this AttemptStatus status) => status switch
    {
        AttemptStatus.InProgress => "作答中",
        AttemptStatus.Submitted => "已交卷",
        AttemptStatus.AutoSubmitted => "超时自动交卷",
        AttemptStatus.ForceSubmitted => "强制交卷",
        AttemptStatus.Abandoned => "已放弃",
        _ => "未开始",
    };
}

public static class SubmitReasons
{
    public static string ToStorage(this SubmitReason reason) => reason switch
    {
        SubmitReason.TimeUp => "time_up",
        SubmitReason.ProctorForce => "proctor_force",
        SubmitReason.AdminForce => "admin_force",
        SubmitReason.NetworkTimeout => "network_timeout",
        _ => "manual",
    };

    public static SubmitReason? FromStorage(string? storage) => storage switch
    {
        "manual" => SubmitReason.Manual,
        "time_up" => SubmitReason.TimeUp,
        "proctor_force" => SubmitReason.ProctorForce,
        "admin_force" => SubmitReason.AdminForce,
        "network_timeout" => SubmitReason.NetworkTimeout,
        _ => null,
    };

    public static string Label(this SubmitReason reason) => reason switch
    {
        SubmitReason.TimeUp => "超时交卷",
        SubmitReason.ProctorForce => "监考强制交卷",
        SubmitReason.AdminForce => "管理员强制交卷",
        SubmitReason.NetworkTimeout => "断网超时代交",
        _ => "主动交卷",
    };
}

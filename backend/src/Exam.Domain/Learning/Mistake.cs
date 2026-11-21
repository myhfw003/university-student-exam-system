using Exam.Domain.SharedKernel.Entities;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Learning;

/// <summary>错因。</summary>
public enum MistakeReason
{
    /// <summary>多选漏选。</summary>
    MultiMissed,

    /// <summary>多选错选。</summary>
    MultiWrong,

    /// <summary>单选错选。</summary>
    SingleWrong,

    /// <summary>判断结论错。</summary>
    JudgeWrong,

    /// <summary>简答要点未覆盖。</summary>
    ShortKeypointsMissed,

    /// <summary>综合题步骤缺失。</summary>
    ComprehensiveStepMissed,

    /// <summary>未作答。</summary>
    Unanswered,
}

/// <summary>错题来源。</summary>
public enum MistakeSourceType
{
    /// <summary>考试。</summary>
    Exam,

    /// <summary>练习。</summary>
    Practice,
}

/// <summary>
/// 错题。做错的题自动进错题本，重做正确后移出。
/// <para>
/// 同一个人同一道题只有一条记录：再次做错就累计次数，做对了就标记掌握。
/// </para>
/// </summary>
public sealed class Mistake : AuditableEntity, IAuditedEntity
{
    private Mistake()
    {
    }

    private Mistake(
        long userId,
        long questionId,
        MistakeReason reason,
        MistakeSourceType sourceType,
        long? sourceAttemptId,
        DateTimeOffset now)
        : base(now, userId)
    {
        UserId = userId;
        QuestionId = questionId;
        Reason = reason;
        SourceType = sourceType;
        SourceAttemptId = sourceAttemptId;
        WrongCount = 1;
        LastWrongAt = now;
    }

    public long UserId { get; private set; }

    public long QuestionId { get; private set; }

    /// <summary>累计错误次数。</summary>
    public int WrongCount { get; private set; }

    /// <summary>最近一次做错的时间。</summary>
    public DateTimeOffset LastWrongAt { get; private set; }

    /// <summary>错因。</summary>
    public MistakeReason Reason { get; private set; }

    /// <summary>来源：考试还是练习。</summary>
    public MistakeSourceType SourceType { get; private set; }

    /// <summary>来源作答会话。</summary>
    public long? SourceAttemptId { get; private set; }

    /// <summary>掌握时间。重做正确后置位。</summary>
    public DateTimeOffset? ResolvedAt { get; private set; }

    public bool IsResolved => ResolvedAt is not null;

    public static Mistake Record(
        long userId,
        long questionId,
        MistakeReason reason,
        MistakeSourceType sourceType,
        long? sourceAttemptId,
        DateTimeOffset now)
    {
        if (userId <= 0 || questionId <= 0)
        {
            throw new BusinessRuleException("错题归属不合法。");
        }

        return new Mistake(userId, questionId, reason, sourceType, sourceAttemptId, now);
    }

    /// <summary>又错了一次。</summary>
    public void RecordWrong(
        MistakeReason reason,
        MistakeSourceType sourceType,
        long? sourceAttemptId,
        DateTimeOffset now)
    {
        WrongCount++;
        Reason = reason;
        SourceType = sourceType;
        SourceAttemptId = sourceAttemptId;
        LastWrongAt = now;
        ResolvedAt = null;
        Touch(now, UserId);
    }

    /// <summary>更新错因，不累计次数（同一次作答里改了分，不算又错一次）。</summary>
    public void RefreshReason(
        MistakeReason reason,
        MistakeSourceType sourceType,
        long? sourceAttemptId,
        DateTimeOffset now)
    {
        Reason = reason;
        SourceType = sourceType;
        SourceAttemptId = sourceAttemptId;
        LastWrongAt = now;
        Touch(now, UserId);
    }

    /// <summary>
    /// 重做正确，标成已掌握。
    /// <para>记录留着，只是不再出现在默认视图里。</para>
    /// </summary>
    public void Resolve(DateTimeOffset now)
    {
        ResolvedAt = now;
        Touch(now, UserId);
    }

    /// <summary>
    /// 移出错题本。
    /// <para>
    /// 软删除（ADR-019）：记录不硬删，数据一直留着，只是不再出现在错题本里。
    /// 掌握时间照样记下——这条记录确实做对过。
    /// </para>
    /// </summary>
    public void RemoveFromNotebook(DateTimeOffset now)
    {
        ResolvedAt = now;
        SoftDelete(now, UserId);
    }

    /// <summary>
    /// 回到错题本：移出去之后又做错了。
    /// <para>
    /// 撤销软删除（ADR-019：删除可撤销），错误次数接着累计——
    /// 不因为管理员改了个开关就把「错了几次」清零。
    /// </para>
    /// </summary>
    public void RestoreToNotebook(DateTimeOffset now)
    {
        DeletedAt = null;
        Touch(now, UserId);
    }

    /// <summary>标记为已掌握。</summary>
    public void MarkMastered(DateTimeOffset now) => Resolve(now);
}

public static class MistakeReasons
{
    public static string ToStorage(this MistakeReason reason) => reason switch
    {
        MistakeReason.MultiMissed => "multi_missed",
        MistakeReason.MultiWrong => "multi_wrong",
        MistakeReason.SingleWrong => "single_wrong",
        MistakeReason.JudgeWrong => "judge_wrong",
        MistakeReason.ShortKeypointsMissed => "short_keypoints_missed",
        MistakeReason.ComprehensiveStepMissed => "comprehensive_step_missed",
        _ => "unanswered",
    };

    public static MistakeReason? FromStorage(string? storage) => storage switch
    {
        "multi_missed" => MistakeReason.MultiMissed,
        "multi_wrong" => MistakeReason.MultiWrong,
        "single_wrong" => MistakeReason.SingleWrong,
        "judge_wrong" => MistakeReason.JudgeWrong,
        "short_keypoints_missed" => MistakeReason.ShortKeypointsMissed,
        "comprehensive_step_missed" => MistakeReason.ComprehensiveStepMissed,
        "unanswered" => MistakeReason.Unanswered,
        _ => null,
    };

    public static string Label(this MistakeReason reason) => reason switch
    {
        MistakeReason.MultiMissed => "多选漏选",
        MistakeReason.MultiWrong => "多选错选",
        MistakeReason.SingleWrong => "单选错选",
        MistakeReason.JudgeWrong => "判断结论错",
        MistakeReason.ShortKeypointsMissed => "简答要点未覆盖",
        MistakeReason.ComprehensiveStepMissed => "综合题步骤缺失",
        _ => "未作答",
    };
}

public static class MistakeSourceTypes
{
    public static string ToStorage(this MistakeSourceType sourceType) => sourceType switch
    {
        MistakeSourceType.Practice => "practice",
        _ => "exam",
    };

    public static MistakeSourceType? FromStorage(string? storage) => storage switch
    {
        "exam" => MistakeSourceType.Exam,
        "practice" => MistakeSourceType.Practice,
        _ => null,
    };

    public static string Label(this MistakeSourceType sourceType) => sourceType switch
    {
        MistakeSourceType.Practice => "练习",
        _ => "考试",
    };
}

using Exam.Domain.SharedKernel.Entities;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Grading;

/// <summary>成绩发布范围。</summary>
public enum GradePublicationScope
{
    /// <summary>全部成绩：客观题与主观题都放出去。</summary>
    All,

    /// <summary>只发布客观题成绩；主观题等定分后另行发布。</summary>
    ObjectiveOnly,
}

/// <summary>
/// 成绩发布。一次发布动作 = 一条记录：谁、什么时候、把哪些作答的成绩放给考生看。
/// <para>
/// 成绩没发布之前，考生只看得到客观题分与「待阅」；发布之后才看得到完整成绩。
/// </para>
/// </summary>
public sealed class GradePublication : AuditableEntity, IAuditedEntity
{
    private GradePublication()
    {
    }

    private GradePublication(
        long examSessionId,
        GradePublicationScope scope,
        IReadOnlyList<long> includedAttemptIds,
        DateTimeOffset now,
        long publisherId)
        : base(now, publisherId)
    {
        ExamSessionId = examSessionId;
        Scope = scope;
        IncludedAttemptIds = includedAttemptIds;
        PublishedAt = now;
        PublishedBy = publisherId;
    }

    /// <summary>所属考试场次。</summary>
    public long ExamSessionId { get; private set; }

    /// <summary>发布范围。</summary>
    public GradePublicationScope Scope { get; private set; }

    /// <summary>发布时间。</summary>
    public DateTimeOffset PublishedAt { get; private set; }

    /// <summary>发布人。</summary>
    public long PublishedBy { get; private set; }

    /// <summary>
    /// 本次发布覆盖的作答会话。
    /// <para>
    /// 快照式：发布那一刻存在的作答才在名单里。发布之后才交卷的人不会被顺带放出去。
    /// </para>
    /// </summary>
    public IReadOnlyList<long> IncludedAttemptIds { get; private set; } = [];

    public static GradePublication Create(
        long examSessionId,
        GradePublicationScope scope,
        IReadOnlyCollection<long> includedAttemptIds,
        DateTimeOffset now,
        long publisherId)
    {
        if (examSessionId <= 0)
        {
            throw new BusinessRuleException("考试场次 ID 不合法。");
        }

        if (includedAttemptIds.Any(id => id <= 0))
        {
            throw new BusinessRuleException("作答会话 ID 不合法。");
        }

        return new GradePublication(
            examSessionId,
            scope,
            includedAttemptIds.Distinct().OrderBy(id => id).ToList(),
            now,
            publisherId);
    }

    /// <summary>这次发布覆盖到这份作答吗？</summary>
    public bool Covers(long attemptId) => IncludedAttemptIds.Contains(attemptId);
}

public static class GradePublicationScopes
{
    public static string ToStorage(this GradePublicationScope scope) => scope switch
    {
        GradePublicationScope.ObjectiveOnly => "objective_only",
        _ => "all",
    };

    public static GradePublicationScope? FromStorage(string? storage) => storage switch
    {
        "all" => GradePublicationScope.All,
        "objective_only" => GradePublicationScope.ObjectiveOnly,
        _ => null,
    };

    public static string Label(this GradePublicationScope scope) => scope switch
    {
        GradePublicationScope.ObjectiveOnly => "仅客观题",
        _ => "全部成绩",
    };
}

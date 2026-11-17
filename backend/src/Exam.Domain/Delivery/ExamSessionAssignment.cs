using Exam.Domain.SharedKernel.Entities;

namespace Exam.Domain.Delivery;

/// <summary>
/// 场次负责人指派。
/// <para>
/// 阅卷教师与监考人员「限所负责场次」的依据：**谁被指派，谁就看这场考试的全部作答、
/// 成绩与监考数据**。指派是显式写下来的事实，不靠角色推断，也不靠「谁建了这场考试」猜。
/// </para>
/// <para>
/// 指派只界定「能看哪些场次」，不授予任何权限：被指派的人仍要自己有
/// `attempt:read-all`、`proctor:monitor` 这些权限点，才看得到对应的数据。
/// </para>
/// </summary>
public sealed class ExamSessionAssignment : Entity<long>, IAuditedEntity
{
    private ExamSessionAssignment()
    {
    }

    private ExamSessionAssignment(long examSessionId, long userId, DateTimeOffset now, long? actorId)
    {
        ExamSessionId = examSessionId;
        UserId = userId;
        CreatedAt = now;
        CreatedBy = actorId;
    }

    /// <summary>被指派的考试场次。</summary>
    public long ExamSessionId { get; private set; }

    /// <summary>被指派的用户。</summary>
    public long UserId { get; private set; }

    /// <summary>指派时间。</summary>
    public DateTimeOffset CreatedAt { get; private set; }

    /// <summary>指派人（管理员或出题教师）。</summary>
    public long? CreatedBy { get; private set; }

    public static ExamSessionAssignment Create(
        long examSessionId,
        long userId,
        DateTimeOffset now,
        long? actorId = null) =>
        new(examSessionId, userId, now, actorId);

    /// <summary>是否指派给了这个用户。</summary>
    public bool IsFor(long userId) => UserId == userId;
}

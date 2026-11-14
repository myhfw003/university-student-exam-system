using Exam.Domain.SharedKernel.Entities;

namespace Exam.Domain.Identity;

/// <summary>
/// 用户与组织维度标签的关联。
/// <para>用户的组织归属不单独存字段，由关联表 + 标签层级推导完整路径。</para>
/// </summary>
public sealed class UserTag : Entity<long>
{
    public UserTag()
    {
    }

    private UserTag(long userId, long tagId, DateTimeOffset assignedAt)
    {
        UserId = userId;
        TagId = tagId;
        AssignedAt = assignedAt;
    }

    public long UserId { get; private set; }

    public long TagId { get; private set; }

    public DateTimeOffset AssignedAt { get; private set; }

    public static UserTag Create(long userId, long tagId, DateTimeOffset assignedAt) =>
        new(userId, tagId, assignedAt);
}

using Exam.Domain.SharedKernel.Entities;

namespace Exam.Domain.Identity;

/// <summary>用户与角色的关联。角色变更即时生效，鉴权时按当前授权快照计算。</summary>
public sealed class UserRole : Entity<long>
{
    public UserRole()
    {
    }

    private UserRole(long userId, long roleId, long? grantedBy, DateTimeOffset now)
    {
        UserId = userId;
        RoleId = roleId;
        GrantedBy = grantedBy;
        GrantedAt = now;
    }

    public long UserId { get; private set; }

    public long RoleId { get; private set; }

    public long? GrantedBy { get; private set; }

    public DateTimeOffset GrantedAt { get; private set; }

    public static UserRole Create(long userId, long roleId, long? grantedBy, DateTimeOffset now) =>
        new(userId, roleId, grantedBy, now);
}

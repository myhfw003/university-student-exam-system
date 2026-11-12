using Exam.Domain.SharedKernel.Entities;

namespace Exam.Domain.Identity;

/// <summary>角色与权限点的关联。</summary>
public sealed class RolePermission : Entity<long>
{
    public RolePermission()
    {
    }

    private RolePermission(long roleId, long permissionId, DateTimeOffset now)
    {
        RoleId = roleId;
        PermissionId = permissionId;
        CreatedAt = now;
    }

    public long RoleId { get; private set; }

    public long PermissionId { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public static RolePermission Create(long roleId, long permissionId, DateTimeOffset now) =>
        new(roleId, permissionId, now);
}

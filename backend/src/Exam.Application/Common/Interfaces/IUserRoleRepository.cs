using Exam.Domain.Identity;

namespace Exam.Application.Common.Interfaces;

public interface IUserRoleRepository : IReadRepository<UserRole>
{
    Task AddAsync(UserRole userRole, CancellationToken cancellationToken = default);

    void Remove(UserRole userRole);

    /// <summary>取回用户拥有的角色 ID 集合。</summary>
    Task<IReadOnlyList<long>> GetRoleIdsAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>取回用户的全部角色关联。</summary>
    Task<IReadOnlyList<UserRole>> GetByUserAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>取回拥有指定角色的全部用户 ID。</summary>
    Task<IReadOnlyList<long>> GetUserIdsByRoleAsync(long roleId, CancellationToken cancellationToken = default);
}

public interface IRolePermissionRepository : IReadRepository<RolePermission>
{
    Task AddAsync(RolePermission rolePermission, CancellationToken cancellationToken = default);

    void Remove(RolePermission rolePermission);

    /// <summary>取回一组角色对应的权限 ID 集合。</summary>
    Task<IReadOnlyList<long>> GetPermissionIdsAsync(
        IReadOnlyCollection<long> roleIds,
        CancellationToken cancellationToken = default);

    /// <summary>取回单个角色的全部权限关联。</summary>
    Task<IReadOnlyList<RolePermission>> GetByRoleAsync(long roleId, CancellationToken cancellationToken = default);
}

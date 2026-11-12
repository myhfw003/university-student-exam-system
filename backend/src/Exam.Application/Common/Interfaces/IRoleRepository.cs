using Exam.Domain.Identity;

namespace Exam.Application.Common.Interfaces;

public interface IRoleRepository : IReadRepository<Role>
{
    Task<Role?> GetByIdAsync(long id, CancellationToken cancellationToken = default);

    Task<Role?> GetByCodeAsync(string code, CancellationToken cancellationToken = default);
}

public interface IPermissionRepository : IReadRepository<Permission>
{
    Task<Permission?> GetByCodeAsync(string code, CancellationToken cancellationToken = default);

    /// <summary>按权限 ID 集合取回权限码。服务端投影，避免把实体加载到应用层。</summary>
    Task<IReadOnlyList<string>> GetCodesAsync(
        IReadOnlyCollection<long> permissionIds,
        CancellationToken cancellationToken = default);
}

public interface IUserRoleRepository : IReadRepository<UserRole>
{
    Task AddAsync(UserRole userRole, CancellationToken cancellationToken = default);

    void Remove(UserRole userRole);

    /// <summary>取回用户拥有的角色 ID 集合。</summary>
    Task<IReadOnlyList<long>> GetRoleIdsAsync(long userId, CancellationToken cancellationToken = default);
}

public interface IRolePermissionRepository : IReadRepository<RolePermission>
{
    Task AddAsync(RolePermission rolePermission, CancellationToken cancellationToken = default);

    void Remove(RolePermission rolePermission);

    /// <summary>取回一组角色对应的权限 ID 集合。</summary>
    Task<IReadOnlyList<long>> GetPermissionIdsAsync(
        IReadOnlyCollection<long> roleIds,
        CancellationToken cancellationToken = default);
}

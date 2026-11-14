using Exam.Domain.Identity;

namespace Exam.Application.Common.Interfaces;

public interface IRoleRepository : IReadRepository<Role>
{
    Task<Role?> GetByIdAsync(long id, CancellationToken cancellationToken = default);

    Task<Role?> GetByCodeAsync(string code, CancellationToken cancellationToken = default);

    Task AddAsync(Role role, CancellationToken cancellationToken = default);

    void Update(Role role);

    /// <summary>列出全部角色，按编码排序。</summary>
    Task<IReadOnlyList<Role>> ListAsync(CancellationToken cancellationToken = default);
}

public interface IPermissionRepository : IReadRepository<Permission>
{
    Task<Permission?> GetByCodeAsync(string code, CancellationToken cancellationToken = default);

    /// <summary>按权限 ID 集合取回权限码。服务端投影，避免把实体加载到应用层。</summary>
    Task<IReadOnlyList<string>> GetCodesAsync(
        IReadOnlyCollection<long> permissionIds,
        CancellationToken cancellationToken = default);

    /// <summary>列出全部权限点，按模块与编码排序。</summary>
    Task<IReadOnlyList<Permission>> ListAsync(CancellationToken cancellationToken = default);

    /// <summary>按权限码集合取回权限点。</summary>
    Task<IReadOnlyList<Permission>> GetByCodesAsync(
        IReadOnlyCollection<string> codes,
        CancellationToken cancellationToken = default);
}

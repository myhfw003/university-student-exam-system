using Exam.Application.Common.Interfaces;
using Exam.Domain.Identity;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class RolePermissionRepository : IRolePermissionRepository
{
    private readonly AppDbContext _db;

    public RolePermissionRepository(AppDbContext db) => _db = db;

    public IQueryable<RolePermission> Query() => _db.RolePermissions.AsNoTracking();

    public async Task AddAsync(RolePermission rolePermission, CancellationToken cancellationToken = default) =>
        await _db.RolePermissions.AddAsync(rolePermission, cancellationToken);

    public void Remove(RolePermission rolePermission) => _db.RolePermissions.Remove(rolePermission);

    public async Task<IReadOnlyList<long>> GetPermissionIdsAsync(
        IReadOnlyCollection<long> roleIds,
        CancellationToken cancellationToken = default)
    {
        if (roleIds.Count == 0)
        {
            return [];
        }

        return await _db.RolePermissions
            .AsNoTracking()
            .Where(x => roleIds.Contains(x.RoleId))
            .Select(x => x.PermissionId)
            .ToListAsync(cancellationToken);
    }
}

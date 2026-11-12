using Exam.Application.Common.Interfaces;
using Exam.Domain.Identity;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class PermissionRepository : IPermissionRepository
{
    private readonly AppDbContext _db;

    public PermissionRepository(AppDbContext db) => _db = db;

    public IQueryable<Permission> Query() => _db.Permissions.AsNoTracking();

    public Task<Permission?> GetByCodeAsync(string code, CancellationToken cancellationToken = default) =>
        _db.Permissions.FirstOrDefaultAsync(x => x.Code == code, cancellationToken);

    public async Task<IReadOnlyList<string>> GetCodesAsync(
        IReadOnlyCollection<long> permissionIds,
        CancellationToken cancellationToken = default)
    {
        if (permissionIds.Count == 0)
        {
            return [];
        }

        return await _db.Permissions
            .AsNoTracking()
            .Where(p => permissionIds.Contains(p.Id))
            .Select(p => p.Code)
            .ToListAsync(cancellationToken);
    }
}

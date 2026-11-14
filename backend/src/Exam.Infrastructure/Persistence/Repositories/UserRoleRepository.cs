using Exam.Application.Common.Interfaces;
using Exam.Domain.Identity;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class UserRoleRepository : IUserRoleRepository
{
    private readonly AppDbContext _db;

    public UserRoleRepository(AppDbContext db) => _db = db;

    public async Task AddAsync(UserRole userRole, CancellationToken cancellationToken = default) =>
        await _db.UserRoles.AddAsync(userRole, cancellationToken);

    public void Remove(UserRole userRole) => _db.UserRoles.Remove(userRole);

    public async Task<IReadOnlyList<long>> GetRoleIdsAsync(long userId, CancellationToken cancellationToken = default) =>
        await _db.UserRoles
            .AsNoTracking()
            .Where(x => x.UserId == userId)
            .Select(x => x.RoleId)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<UserRole>> GetByUserAsync(
        long userId,
        CancellationToken cancellationToken = default) =>
        await _db.UserRoles
            .Where(x => x.UserId == userId)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<long>> GetUserIdsByRoleAsync(
        long roleId,
        CancellationToken cancellationToken = default) =>
        await _db.UserRoles
            .AsNoTracking()
            .Where(x => x.RoleId == roleId)
            .Select(x => x.UserId)
            .ToListAsync(cancellationToken);
}

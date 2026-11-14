using Exam.Application.Common.Interfaces;
using Exam.Domain.Identity;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class UserRepository : IUserRepository
{
    private readonly AppDbContext _db;

    public UserRepository(AppDbContext db) => _db = db;

    public Task<User?> GetByIdAsync(long id, CancellationToken cancellationToken = default) =>
        _db.Users.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

    public Task<User?> GetByUsernameAsync(string username, CancellationToken cancellationToken = default) =>
        _db.Users.FirstOrDefaultAsync(
            x => x.Username.ToLower() == username.ToLower(),
            cancellationToken);

    public async Task AddAsync(User user, CancellationToken cancellationToken = default) =>
        await _db.Users.AddAsync(user, cancellationToken);

    public void Update(User user) => _db.Users.Update(user);

    public async Task<IReadOnlyList<User>> SearchAsync(
        string? keyword,
        UserStatus? status,
        long? roleId,
        int skip,
        int take,
        CancellationToken cancellationToken = default)
    {
        var query = Filtered(keyword, status, roleId);

        return await query
            .OrderByDescending(u => u.UpdatedAt ?? u.CreatedAt)
            .ThenBy(u => u.Id)
            .Skip(skip)
            .Take(take)
            .ToListAsync(cancellationToken);
    }

    public async Task<int> CountAsync(
        string? keyword,
        UserStatus? status,
        long? roleId,
        CancellationToken cancellationToken = default) =>
        await Filtered(keyword, status, roleId).CountAsync(cancellationToken);

    public async Task<IReadOnlyList<long>> GetUserIdsByRoleAsync(
        long roleId,
        CancellationToken cancellationToken = default) =>
        await _db.UserRoles
            .AsNoTracking()
            .Where(x => x.RoleId == roleId)
            .Select(x => x.UserId)
            .ToListAsync(cancellationToken);

    private IQueryable<User> Filtered(string? keyword, UserStatus? status, long? roleId)
    {
        var query = _db.Users.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(keyword))
        {
            var lowered = keyword.Trim().ToLower();
            query = query.Where(u =>
                u.Username.ToLower().Contains(lowered)
                || u.DisplayName.ToLower().Contains(lowered)
                || (u.Email != null && u.Email.ToLower().Contains(lowered)));
        }

        if (status is not null)
        {
            query = query.Where(u => u.Status == status.Value);
        }

        if (roleId is not null)
        {
            var usersWithRole = _db.UserRoles.AsNoTracking().Where(x => x.RoleId == roleId.Value).Select(x => x.UserId);
            query = query.Where(u => usersWithRole.Contains(u.Id));
        }

        return query;
    }
}

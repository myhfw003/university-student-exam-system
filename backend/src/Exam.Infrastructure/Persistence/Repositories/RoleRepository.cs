using Exam.Application.Common.Interfaces;
using Exam.Domain.Identity;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class RoleRepository : IRoleRepository
{
    private readonly AppDbContext _db;

    public RoleRepository(AppDbContext db) => _db = db;

    public Task<Role?> GetByIdAsync(long id, CancellationToken cancellationToken = default) =>
        _db.Roles.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

    public Task<Role?> GetByCodeAsync(string code, CancellationToken cancellationToken = default) =>
        _db.Roles.FirstOrDefaultAsync(x => x.Code == code, cancellationToken);

    public async Task AddAsync(Role role, CancellationToken cancellationToken = default) =>
        await _db.Roles.AddAsync(role, cancellationToken);

    public void Update(Role role) => _db.Roles.Update(role);

    public async Task<IReadOnlyList<Role>> ListAsync(CancellationToken cancellationToken = default) =>
        await _db.Roles
            .AsNoTracking()
            .OrderBy(r => r.Code)
            .ToListAsync(cancellationToken);
}

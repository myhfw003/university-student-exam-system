using Exam.Application.Common.Interfaces;
using Exam.Domain.Learning;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class AbilityProfileRepository : IAbilityProfileRepository
{
    private readonly AppDbContext _db;

    public AbilityProfileRepository(AppDbContext db) => _db = db;

    public Task<AbilityProfile?> GetAsync(
        long userId,
        long abilityTagId,
        CancellationToken cancellationToken = default) =>
        _db.Set<AbilityProfile>()
            .FirstOrDefaultAsync(
                p => p.UserId == userId && p.AbilityTagId == abilityTagId,
                cancellationToken);

    public async Task<IReadOnlyList<AbilityProfile>> ListByUserAsync(
        long userId,
        CancellationToken cancellationToken = default) =>
        await _db.Set<AbilityProfile>()
            .AsNoTracking()
            .Where(p => p.UserId == userId)
            .OrderByDescending(p => p.MasteryRate)
            .ThenBy(p => p.AbilityTagId)
            .ToListAsync(cancellationToken);

    public async Task AddAsync(AbilityProfile profile, CancellationToken cancellationToken = default) =>
        await _db.Set<AbilityProfile>().AddAsync(profile, cancellationToken);

    public void Update(AbilityProfile profile) => _db.Set<AbilityProfile>().Update(profile);
}

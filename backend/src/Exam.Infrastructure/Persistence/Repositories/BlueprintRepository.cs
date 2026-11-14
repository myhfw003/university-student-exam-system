using Exam.Application.Common.Interfaces;
using Exam.Domain.Authoring;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class BlueprintRepository : IBlueprintRepository
{
    private readonly AppDbContext _db;

    public BlueprintRepository(AppDbContext db) => _db = db;

    public Task<Blueprint?> GetByPaperAsync(long paperId, CancellationToken cancellationToken = default) =>
        _db.Set<Blueprint>()
            .FirstOrDefaultAsync(b => b.PaperId == paperId, cancellationToken);

    public async Task AddAsync(Blueprint blueprint, CancellationToken cancellationToken = default) =>
        await _db.Set<Blueprint>().AddAsync(blueprint, cancellationToken);

    public void Update(Blueprint blueprint) => _db.Set<Blueprint>().Update(blueprint);
}

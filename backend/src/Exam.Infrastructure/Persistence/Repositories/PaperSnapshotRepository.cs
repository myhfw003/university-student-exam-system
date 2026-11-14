using Exam.Application.Common.Interfaces;
using Exam.Domain.Authoring;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class PaperSnapshotRepository : IPaperSnapshotRepository
{
    private readonly AppDbContext _db;

    public PaperSnapshotRepository(AppDbContext db) => _db = db;

    public Task<PaperSnapshot?> GetByIdAsync(long id, CancellationToken cancellationToken = default) =>
        _db.Set<PaperSnapshot>()
            .Include(s => s.Items)
            .FirstOrDefaultAsync(s => s.Id == id, cancellationToken);

    public Task<PaperSnapshot?> GetLatestAsync(long paperId, CancellationToken cancellationToken = default) =>
        _db.Set<PaperSnapshot>()
            .Include(s => s.Items)
            .Where(s => s.PaperId == paperId)
            .OrderByDescending(s => s.SnapshotVersion)
            .FirstOrDefaultAsync(cancellationToken);

    public async Task<IReadOnlyList<PaperSnapshot>> ListByPaperAsync(
        long paperId,
        CancellationToken cancellationToken = default) =>
        await _db.Set<PaperSnapshot>()
            .AsNoTracking()
            .Include(s => s.Items)
            .Where(s => s.PaperId == paperId)
            .OrderByDescending(s => s.SnapshotVersion)
            .ToListAsync(cancellationToken);

    public Task<int> CountByPaperAsync(long paperId, CancellationToken cancellationToken = default) =>
        _db.Set<PaperSnapshot>().CountAsync(s => s.PaperId == paperId, cancellationToken);

    public async Task AddAsync(PaperSnapshot snapshot, CancellationToken cancellationToken = default) =>
        await _db.Set<PaperSnapshot>().AddAsync(snapshot, cancellationToken);
}

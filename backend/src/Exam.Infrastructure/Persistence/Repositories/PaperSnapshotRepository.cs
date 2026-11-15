using Exam.Application.Authoring.Services;
using Exam.Application.Common.Interfaces;
using Exam.Domain.Authoring;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class PaperSnapshotRepository : IPaperSnapshotRepository
{
    private readonly AppDbContext _db;
    private readonly PaperSnapshotCache _cache;

    public PaperSnapshotRepository(AppDbContext db, PaperSnapshotCache cache)
    {
        _db = db;
        _cache = cache;
    }

    public async Task<PaperSnapshot?> GetByIdAsync(long id, CancellationToken cancellationToken = default)
    {
        // 快照不可变：缓存命中就别回库。
        if (_cache.TryGet(id, out var cached))
        {
            return cached;
        }

        var snapshot = await _db.Set<PaperSnapshot>()
            .AsNoTracking()
            .Include(s => s.Items)
            .FirstOrDefaultAsync(s => s.Id == id, cancellationToken);

        if (snapshot is not null)
        {
            _cache.Set(snapshot.Id, snapshot);
        }

        return snapshot;
    }

    public async Task<PaperSnapshot?> GetLatestAsync(long paperId, CancellationToken cancellationToken = default)
    {
        var latest = await _db.Set<PaperSnapshot>()
            .AsNoTracking()
            .Where(s => s.PaperId == paperId)
            .OrderByDescending(s => s.SnapshotVersion)
            .FirstOrDefaultAsync(cancellationToken);

        if (latest is null)
        {
            return null;
        }

        if (!_cache.TryGet(latest.Id, out var cached))
        {
            // 带题目的完整快照才进缓存：题面是进考场时真正要读的部分。
            var full = await _db.Set<PaperSnapshot>()
                .AsNoTracking()
                .Include(s => s.Items)
                .FirstOrDefaultAsync(s => s.Id == latest.Id, cancellationToken);

            if (full is null)
            {
                return null;
            }

            _cache.Set(full.Id, full);
            return full;
        }

        return cached;
    }

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

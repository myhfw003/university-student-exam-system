using Exam.Application.Common.Interfaces;
using Exam.Domain.Authoring;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class PaperRepository : IPaperRepository
{
    private readonly AppDbContext _db;

    public PaperRepository(AppDbContext db) => _db = db;

    public Task<Paper?> GetByIdAsync(long id, CancellationToken cancellationToken = default) =>
        _db.Papers
            .Include(p => p.Items)
            .Include(p => p.Sections)
            .Include(p => p.Tags)
            .FirstOrDefaultAsync(p => p.Id == id, cancellationToken);

    public async Task<IReadOnlyList<Paper>> ListAsync(
        PaperKind? kind,
        PaperStatus? status,
        string? keyword,
        int skip,
        int take,
        CancellationToken cancellationToken = default)
    {
        var query = Filtered(kind, status, keyword);

        return await query
            .OrderByDescending(p => p.UpdatedAt ?? p.CreatedAt)
            .ThenByDescending(p => p.Id)
            .Skip(skip)
            .Take(take)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Paper>> GetByIdsAsync(
        IReadOnlyCollection<long> ids,
        CancellationToken cancellationToken = default)
    {
        if (ids.Count == 0)
        {
            return [];
        }

        var idList = ids.ToList();
        return await _db.Papers
            .AsNoTracking()
            .Include(p => p.Items)
            .Where(p => idList.Contains(p.Id))
            .ToListAsync(cancellationToken);
    }

    public Task<int> CountAsync(
        PaperKind? kind,
        PaperStatus? status,
        string? keyword,
        CancellationToken cancellationToken = default) =>
        Filtered(kind, status, keyword).CountAsync(cancellationToken);

    public async Task<IReadOnlyList<Paper>> ListByCreatorAsync(
        long userId,
        CancellationToken cancellationToken = default) =>
        await _db.Papers
            .AsNoTracking()
            .Include(p => p.Items)
            .Where(p => p.CreatedBy == userId)
            .OrderByDescending(p => p.UpdatedAt ?? p.CreatedAt)
            .ThenByDescending(p => p.Id)
            .ToListAsync(cancellationToken);

    public async Task AddAsync(Paper paper, CancellationToken cancellationToken = default) =>
        await _db.Papers.AddAsync(paper, cancellationToken);

    public void Update(Paper paper) => _db.Papers.Update(paper);

    private IQueryable<Paper> Filtered(PaperKind? kind, PaperStatus? status, string? keyword)
    {
        var query = _db.Papers.AsNoTracking();

        if (kind is not null)
        {
            query = query.Where(p => p.Kind == kind.Value);
        }

        if (status is not null)
        {
            query = query.Where(p => p.Status == status.Value);
        }

        if (!string.IsNullOrWhiteSpace(keyword))
        {
            var lowered = keyword.Trim().ToLower();
            query = query.Where(p =>
                p.Name.ToLower().Contains(lowered)
                || (p.Batch != null && p.Batch.ToLower().Contains(lowered)));
        }

        return query;
    }
}

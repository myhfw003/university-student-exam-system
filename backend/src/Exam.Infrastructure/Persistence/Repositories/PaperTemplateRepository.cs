using Exam.Application.Common.Interfaces;
using Exam.Domain.Authoring;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class PaperTemplateRepository : IPaperTemplateRepository
{
    private readonly AppDbContext _db;

    public PaperTemplateRepository(AppDbContext db) => _db = db;

    public Task<PaperTemplate?> GetByIdAsync(long id, CancellationToken cancellationToken = default) =>
        _db.Set<PaperTemplate>()
            .Include(t => t.Items)
            .FirstOrDefaultAsync(t => t.Id == id, cancellationToken);

    public async Task<IReadOnlyList<PaperTemplate>> ListAsync(
        PaperKind? kind,
        string? keyword,
        CancellationToken cancellationToken = default)
    {
        IQueryable<PaperTemplate> query = _db.Set<PaperTemplate>()
            .AsNoTracking()
            .Include(t => t.Items);

        if (kind is not null)
        {
            query = query.Where(t => t.Kind == kind.Value);
        }

        if (!string.IsNullOrWhiteSpace(keyword))
        {
            var pattern = $"%{keyword.Trim()}%";
            query = query.Where(t => EF.Functions.ILike(t.Name, pattern));
        }

        return await query
            .OrderByDescending(t => t.CreatedAt)
            .ThenByDescending(t => t.Id)
            .ToListAsync(cancellationToken);
    }

    public async Task AddAsync(PaperTemplate template, CancellationToken cancellationToken = default) =>
        await _db.Set<PaperTemplate>().AddAsync(template, cancellationToken);

    public void Update(PaperTemplate template) => _db.Set<PaperTemplate>().Update(template);
}

using Exam.Application.Common.Interfaces;
using Exam.Domain.Catalog;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class ImportBatchRepository : IImportBatchRepository
{
    private readonly AppDbContext _db;

    public ImportBatchRepository(AppDbContext db) => _db = db;

    public Task<ImportBatch?> GetByIdAsync(long id, CancellationToken cancellationToken = default) =>
        _db.ImportBatches
            .Include(b => b.Rows)
            .FirstOrDefaultAsync(b => b.Id == id, cancellationToken);

    public async Task<IReadOnlyList<ImportBatch>> ListAsync(
        int skip,
        int take,
        CancellationToken cancellationToken = default) =>
        await _db.ImportBatches
            .AsNoTracking()
            .Include(b => b.Rows)
            .OrderByDescending(b => b.CreatedAt)
            .ThenByDescending(b => b.Id)
            .Skip(skip)
            .Take(take)
            .ToListAsync(cancellationToken);

    public Task<int> CountAsync(CancellationToken cancellationToken = default) =>
        _db.ImportBatches.CountAsync(cancellationToken);

    public async Task AddAsync(ImportBatch batch, CancellationToken cancellationToken = default) =>
        await _db.ImportBatches.AddAsync(batch, cancellationToken);

    public void Update(ImportBatch batch) => _db.ImportBatches.Update(batch);
}

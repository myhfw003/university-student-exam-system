using Exam.Domain.Catalog;

namespace Exam.Application.Common.Interfaces;

public interface IImportBatchRepository
{
    Task<ImportBatch?> GetByIdAsync(long id, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<ImportBatch>> ListAsync(int skip, int take, CancellationToken cancellationToken = default);

    Task<int> CountAsync(CancellationToken cancellationToken = default);

    Task AddAsync(ImportBatch batch, CancellationToken cancellationToken = default);

    void Update(ImportBatch batch);
}

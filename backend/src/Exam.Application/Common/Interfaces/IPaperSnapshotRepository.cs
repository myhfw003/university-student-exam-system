using Exam.Domain.Authoring;

namespace Exam.Application.Common.Interfaces;

public interface IPaperSnapshotRepository
{
    Task<PaperSnapshot?> GetByIdAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>取回某份试卷的最新快照。</summary>
    Task<PaperSnapshot?> GetLatestAsync(long paperId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<PaperSnapshot>> ListByPaperAsync(long paperId, CancellationToken cancellationToken = default);

    Task<int> CountByPaperAsync(long paperId, CancellationToken cancellationToken = default);

    Task AddAsync(PaperSnapshot snapshot, CancellationToken cancellationToken = default);
}

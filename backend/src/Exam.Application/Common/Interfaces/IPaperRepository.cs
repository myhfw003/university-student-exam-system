using Exam.Domain.Authoring;

namespace Exam.Application.Common.Interfaces;

public interface IPaperRepository
{
    Task<Paper?> GetByIdAsync(long id, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<Paper>> ListAsync(
        PaperKind? kind,
        PaperStatus? status,
        string? keyword,
        int skip,
        int take,
        CancellationToken cancellationToken = default);

    Task<int> CountAsync(
        PaperKind? kind,
        PaperStatus? status,
        string? keyword,
        CancellationToken cancellationToken = default);

    Task AddAsync(Paper paper, CancellationToken cancellationToken = default);

    void Update(Paper paper);

    void Remove(Paper paper);
}

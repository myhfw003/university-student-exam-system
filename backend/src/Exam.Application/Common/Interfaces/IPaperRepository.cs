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

    /// <summary>按主键集合取回试卷。</summary>
    Task<IReadOnlyList<Paper>> GetByIdsAsync(
        IReadOnlyCollection<long> ids,
        CancellationToken cancellationToken = default);

    Task<int> CountAsync(
        PaperKind? kind,
        PaperStatus? status,
        string? keyword,
        CancellationToken cancellationToken = default);

    /// <summary>列出某人创建的试卷（范围判定用：自己的卷子）。</summary>
    Task<IReadOnlyList<Paper>> ListByCreatorAsync(
        long userId,
        CancellationToken cancellationToken = default);

    Task AddAsync(Paper paper, CancellationToken cancellationToken = default);

    void Update(Paper paper);
}

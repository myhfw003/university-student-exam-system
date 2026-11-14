using Exam.Domain.Delivery;

namespace Exam.Application.Common.Interfaces;

public interface IExamSessionRepository
{
    Task<ExamSession?> GetByIdAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>列出场次，可按状态与关键词过滤。</summary>
    Task<IReadOnlyList<ExamSession>> ListAsync(
        ExamSessionStatus? status,
        string? keyword,
        CancellationToken cancellationToken = default);

    /// <summary>按主键集合取回场次。</summary>
    Task<IReadOnlyList<ExamSession>> GetByIdsAsync(
        IReadOnlyCollection<long> ids,
        CancellationToken cancellationToken = default);

    Task<int> CountAsync(
        ExamSessionStatus? status,
        string? keyword,
        CancellationToken cancellationToken = default);

    Task AddAsync(ExamSession session, CancellationToken cancellationToken = default);

    void Update(ExamSession session);

    void Remove(ExamSession session);
}

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

    /// <summary>列出某人创建的场次（范围判定用：自己负责的场次）。</summary>
    Task<IReadOnlyList<ExamSession>> ListByCreatorAsync(
        long userId,
        CancellationToken cancellationToken = default);

    /// <summary>列出挂在这些试卷下的场次（自己出的卷子对应的场次）。</summary>
    Task<IReadOnlyList<ExamSession>> ListByPaperIdsAsync(
        IReadOnlyCollection<long> paperIds,
        CancellationToken cancellationToken = default);

    /// <summary>列出全员开放且已发布的场次（学生能看到的公开场次）。</summary>
    Task<IReadOnlyList<ExamSession>> ListOpenToAllPublishedAsync(
        CancellationToken cancellationToken = default);

    Task AddAsync(ExamSession session, CancellationToken cancellationToken = default);

    void Update(ExamSession session);

    void Remove(ExamSession session);
}

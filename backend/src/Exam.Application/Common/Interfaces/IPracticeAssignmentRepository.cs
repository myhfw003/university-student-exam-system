using Exam.Domain.Learning;

namespace Exam.Application.Common.Interfaces;

/// <summary>练习开放单。</summary>
public interface IPracticeAssignmentRepository
{
    Task<PracticeAssignment?> GetByIdAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>按主键集合取回练习开放单。</summary>
    Task<IReadOnlyList<PracticeAssignment>> GetByIdsAsync(
        IReadOnlyCollection<long> ids,
        CancellationToken cancellationToken = default);

    /// <summary>管理端列表：可按状态与关键词过滤。</summary>
    Task<IReadOnlyList<PracticeAssignment>> ListAsync(
        PracticeAssignmentStatus? status,
        string? keyword,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// 列出当前已上架且在开放期内的练习开放单。
    /// <para>名单范围（组织标签）由应用层判定，这里只管「上架了没、开着没」。</para>
    /// </summary>
    Task<IReadOnlyList<PracticeAssignment>> ListPublishedOpenAsync(
        DateTimeOffset now,
        CancellationToken cancellationToken = default);

    Task AddAsync(PracticeAssignment assignment, CancellationToken cancellationToken = default);

    void Update(PracticeAssignment assignment);
}

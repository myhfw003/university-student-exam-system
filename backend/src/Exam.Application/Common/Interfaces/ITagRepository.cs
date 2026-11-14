using Exam.Domain.Catalog;

namespace Exam.Application.Common.Interfaces;

public interface ITagRepository : IReadRepository<Tag>
{
    Task<Tag?> GetByIdAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>按编码查询，忽略大小写。</summary>
    Task<Tag?> GetByCodeAsync(string code, CancellationToken cancellationToken = default);

    Task AddAsync(Tag tag, CancellationToken cancellationToken = default);

    void Update(Tag tag);

    void Remove(Tag tag);

    /// <summary>列出全部标签，可按维度过滤。排序：维度 → 排序号 → 主键。</summary>
    Task<IReadOnlyList<Tag>> ListAsync(TagGroup? group, CancellationToken cancellationToken = default);

    /// <summary>取回指定父标签的直接子标签。</summary>
    Task<IReadOnlyList<Tag>> GetChildrenAsync(long parentId, CancellationToken cancellationToken = default);

    /// <summary>按主键集合取回标签。</summary>
    Task<IReadOnlyList<Tag>> GetByIdsAsync(
        IReadOnlyCollection<long> ids,
        CancellationToken cancellationToken = default);

    /// <summary>取回指定标签的全部后代（含自身）。由数据库递归查询实现。</summary>
    Task<IReadOnlyList<long>> GetDescendantIdsAsync(
        long rootId,
        bool includeSelf,
        CancellationToken cancellationToken = default);

    /// <summary>取回指定标签的全部祖先 ID 集合。</summary>
    Task<IReadOnlyList<long>> GetAncestorIdsAsync(long id, CancellationToken cancellationToken = default);

    /// <summary>取回指定父标签的直接子标签数量。</summary>
    Task<int> CountChildrenAsync(long parentId, CancellationToken cancellationToken = default);
}

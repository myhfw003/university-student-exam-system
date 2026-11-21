using Exam.Application.Common.Interfaces;
using Exam.Domain.Catalog;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class TagRepository : ITagRepository
{
    private readonly AppDbContext _db;

    public TagRepository(AppDbContext db) => _db = db;

    public Task<Tag?> GetByIdAsync(long id, CancellationToken cancellationToken = default) =>
        _db.Tags.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

    public Task<Tag?> GetByCodeAsync(string code, CancellationToken cancellationToken = default) =>
        _db.Tags.AsNoTracking().FirstOrDefaultAsync(
            x => x.Code.ToLower() == code.ToLower(),
            cancellationToken);

    public async Task AddAsync(Tag tag, CancellationToken cancellationToken = default) =>
        await _db.Tags.AddAsync(tag, cancellationToken);

    public void Update(Tag tag) => _db.Tags.Update(tag);

    public async Task<IReadOnlyList<Tag>> ListAsync(
        TagGroup? group,
        CancellationToken cancellationToken = default)
    {
        var query = _db.Tags.AsNoTracking();

        if (group is not null)
        {
            query = query.Where(t => t.Group == group.Value);
        }

        return await query
            .OrderBy(t => t.Group)
            .ThenBy(t => t.SortOrder)
            .ThenBy(t => t.Id)
            .ToListAsync(cancellationToken);
    }

    public async Task<Tag?> GetByParentAndNameAsync(
        long? parentId,
        string name,
        CancellationToken cancellationToken = default) =>
        await _db.Tags.AsNoTracking().FirstOrDefaultAsync(
            x => x.ParentId == parentId && x.Name == name,
            cancellationToken);

    public async Task<IReadOnlyList<Tag>> GetByNamesAsync(
        IReadOnlyCollection<string> names,
        TagGroup? group,
        CancellationToken cancellationToken = default)
    {
        if (names.Count == 0)
        {
            return [];
        }

        var nameList = names.ToList();
        var query = _db.Tags.AsNoTracking().Where(t => nameList.Contains(t.Name));

        if (group is not null)
        {
            query = query.Where(t => t.Group == group.Value);
        }

        return await query.ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Tag>> GetChildrenAsync(
        long parentId,
        CancellationToken cancellationToken = default) =>
        await _db.Tags.AsNoTracking()
            .Where(t => t.ParentId == parentId)
            .OrderBy(t => t.SortOrder)
            .ThenBy(t => t.Id)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<Tag>> GetByIdsAsync(
        IReadOnlyCollection<long> ids,
        CancellationToken cancellationToken = default)
    {
        if (ids.Count == 0)
        {
            return [];
        }

        var idList = ids.ToList();
        return await _db.Tags.AsNoTracking()
            .Where(t => idList.Contains(t.Id))
            .OrderBy(t => t.Group)
            .ThenBy(t => t.SortOrder)
            .ThenBy(t => t.Id)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Tag>> GetWithAncestorsAsync(
        IReadOnlyCollection<long> ids,
        CancellationToken cancellationToken = default)
    {
        if (ids.Count == 0)
        {
            return [];
        }

        var all = new HashSet<long>(ids);
        foreach (var id in ids)
        {
            var ancestors = await GetAncestorIdsAsync(id, cancellationToken);
            all.UnionWith(ancestors);
        }

        return await GetByIdsAsync(all.ToList(), cancellationToken);
    }

    /// <summary>
    /// 递归 CTE 一次展开全部后代，避免逐层查询。
    /// </summary>
    public async Task<IReadOnlyList<long>> GetDescendantIdsAsync(
        long rootId,
        bool includeSelf,
        CancellationToken cancellationToken = default)
    {
        var ids = await _db.Database
            .SqlQueryRaw<long>(
                """
                WITH RECURSIVE tree AS (
                    SELECT id FROM catalog.tag WHERE id = {0} AND deleted_at IS NULL
                    UNION ALL
                    SELECT t.id FROM catalog.tag t
                    JOIN tree ON t.parent_id = tree.id
                    WHERE t.deleted_at IS NULL
                )
                SELECT id FROM tree
                """,
                rootId)
            .ToListAsync(cancellationToken);

        return includeSelf ? ids : ids.Where(id => id != rootId).ToList();
    }

    /// <summary>沿 parent_id 上溯得到全部祖先 ID（不含自身）。</summary>
    public async Task<IReadOnlyList<long>> GetAncestorIdsAsync(
        long id,
        CancellationToken cancellationToken = default)
    {
        var ids = await _db.Database
            .SqlQueryRaw<long>(
                """
                WITH RECURSIVE up AS (
                    SELECT id, parent_id FROM catalog.tag WHERE id = {0} AND deleted_at IS NULL
                    UNION ALL
                    SELECT t.id, t.parent_id FROM catalog.tag t JOIN up ON up.parent_id = t.id
                    WHERE t.deleted_at IS NULL
                )
                SELECT id FROM up WHERE id <> {0}
                """,
                id)
            .ToListAsync(cancellationToken);

        return ids;
    }

    public Task<int> CountChildrenAsync(long parentId, CancellationToken cancellationToken = default) =>
        _db.Tags.CountAsync(x => x.ParentId == parentId, cancellationToken);
}

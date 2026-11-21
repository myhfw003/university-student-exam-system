using Exam.Application.Common.Interfaces;
using Exam.Domain.Catalog;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class QuestionRepository : IQuestionRepository
{
    private readonly AppDbContext _db;

    /// <summary>本次请求内已展开的标签子树（按根标签缓存）。</summary>
    private readonly Dictionary<long, long[]> _subtreeCache = new();

    public QuestionRepository(AppDbContext db) => _db = db;

    public Task<Question?> GetByIdAsync(long id, CancellationToken cancellationToken = default) =>
        _db.Questions
            .Include(q => q.Options)
            .Include(q => q.Keypoints)
            .Include(q => q.Steps)
            .Include(q => q.Attachments)
            .Include(q => q.Tags)
            .FirstOrDefaultAsync(q => q.Id == id, cancellationToken);

    public Task<Question?> GetByCodeAsync(string code, CancellationToken cancellationToken = default) =>
        _db.Questions
            .Include(q => q.Options)
            .Include(q => q.Keypoints)
            .Include(q => q.Steps)
            .Include(q => q.Attachments)
            .Include(q => q.Tags)
            .FirstOrDefaultAsync(q => q.Code == code, cancellationToken);

    public Task<bool> CodeExistsAsync(
        string code,
        long? excludeQuestionId,
        CancellationToken cancellationToken = default) =>
        _db.Questions
            .AnyAsync(
                q => q.Code == code && (excludeQuestionId == null || q.Id != excludeQuestionId.Value),
                cancellationToken);

    public async Task AddAsync(Question question, CancellationToken cancellationToken = default) =>
        await _db.Questions.AddAsync(question, cancellationToken);

    public void Update(Question question) => _db.Questions.Update(question);

    public async Task<IReadOnlyList<Question>> SearchAsync(
        QuestionSearchCriteria criteria,
        CancellationToken cancellationToken = default)
    {
        var query = await BuildQueryAsync(criteria, cancellationToken);

        query = criteria.SortBy switch
        {
            "createdAt" => criteria.SortDescending
                ? query.OrderByDescending(q => q.CreatedAt).ThenByDescending(q => q.Id)
                : query.OrderBy(q => q.CreatedAt).ThenBy(q => q.Id),
            "code" => criteria.SortDescending
                ? query.OrderByDescending(q => q.Code).ThenByDescending(q => q.Id)
                : query.OrderBy(q => q.Code).ThenBy(q => q.Id),
            _ => criteria.SortDescending
                ? query.OrderByDescending(q => q.UpdatedAt ?? q.CreatedAt).ThenByDescending(q => q.Id)
                : query.OrderBy(q => q.UpdatedAt ?? q.CreatedAt).ThenBy(q => q.Id),
        };

        return await query
            .Skip(criteria.Skip)
            .Take(criteria.Take)
            .ToListAsync(cancellationToken);
    }

    public async Task<int> CountAsync(
        QuestionSearchCriteria criteria,
        CancellationToken cancellationToken = default)
    {
        var query = await BuildQueryAsync(criteria, cancellationToken);
        return await query.CountAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Question>> GetByIdsAsync(
        IReadOnlyCollection<long> ids,
        CancellationToken cancellationToken = default)
    {
        if (ids.Count == 0)
        {
            return [];
        }

        var idList = ids.ToList();
        return await _db.Questions
            .AsNoTracking()
            .Include(q => q.Options)
            .Include(q => q.Keypoints)
            .Include(q => q.Steps)
            .Include(q => q.Attachments)
            .Include(q => q.Tags)
            .Where(q => idList.Contains(q.Id))
            .OrderBy(q => q.Id)
            .ToListAsync(cancellationToken);
    }

    private async Task<IQueryable<Question>> BuildQueryAsync(
        QuestionSearchCriteria criteria,
        CancellationToken cancellationToken)
    {
        IQueryable<Question> query = _db.Questions.AsNoTracking()
            .Include(q => q.Options)
            .Include(q => q.Tags);

        if (criteria.Type is not null)
        {
            query = query.Where(q => q.Type == criteria.Type.Value);
        }

        if (criteria.Status is not null)
        {
            query = query.Where(q => q.Status == criteria.Status.Value);
        }

        if (criteria.DifficultyTagIds.Count > 0)
        {
            var difficultyIds = criteria.DifficultyTagIds;
            query = query.Where(q => difficultyIds.Contains(q.DifficultyTagId));
        }

        if (criteria.TagIds.Count > 0)
        {
            // 选中的标签去重：同一个标签重复选中不应改变筛选结果。
            var roots = criteria.TagIds.Distinct().ToList();

            if (criteria.MatchMode == TagMatchMode.All)
            {
                // 全部命中：每个选中的标签都要被命中。
                // 含子标签时，命中该标签的任意后代也算命中它。
                foreach (var root in roots)
                {
                    var hits = criteria.IncludeDescendants
                        ? await GetSubtreeAsync(root, cancellationToken)
                        : [root];
                    query = query.Where(q => q.Tags.Any(t => hits.Contains(t.TagId)));
                }
            }
            else
            {
                // 任一命中：命中任意一个选中的标签（含其后代）即可。
                var tagIds = criteria.IncludeDescendants
                    ? await ExpandDescendantsAsync(roots, cancellationToken)
                    : roots;
                query = query.Where(q => q.Tags.Any(t => tagIds.Contains(t.TagId)));
            }
        }

        if (criteria.BankId is not null)
        {
            var bankId = criteria.BankId.Value;
            var bankQuestions = _db.Set<QuestionBankItem>()
                .AsNoTracking()
                .Where(i => i.BankId == bankId)
                .Select(i => i.QuestionId);

            query = query.Where(q => bankQuestions.Contains(q.Id));
        }

        if (!string.IsNullOrWhiteSpace(criteria.Keyword))
        {
            var keyword = EscapeLike(criteria.Keyword.Trim());
            query = query.Where(q =>
                EF.Functions.ILike(q.Code, $"%{keyword}%")
                || EF.Functions.ILike(q.Stem, $"%{keyword}%"));
        }

        return query;
    }

    /// <summary>
    /// 取标签自身与它的全部后代。
    /// <para>
    /// 同一请求里重复展开没有意义（列表查询会分别数总数与取当页），
    /// 这里按实例缓存一份：仓库是 Scoped 生命周期，缓存只活在本次请求内。
    /// </para>
    /// </summary>
    private async Task<long[]> GetSubtreeAsync(long rootId, CancellationToken cancellationToken)
    {
        if (_subtreeCache.TryGetValue(rootId, out var cached))
        {
            return cached;
        }

        var ids = await ExpandDescendantsAsync([rootId], cancellationToken);
        var subtree = ids.ToArray();
        _subtreeCache[rootId] = subtree;
        return subtree;
    }

    /// <summary>递归 CTE 展开标签的全部后代。</summary>
    private async Task<IReadOnlyList<long>> ExpandDescendantsAsync(
        IReadOnlyList<long> tagIds,
        CancellationToken cancellationToken)
    {
        var ids = await _db.Database
            .SqlQueryRaw<long>(
                """
                WITH RECURSIVE tree AS (
                    SELECT id FROM catalog.tag WHERE id = ANY({0}) AND deleted_at IS NULL
                    UNION ALL
                    SELECT t.id FROM catalog.tag t
                    JOIN tree ON t.parent_id = tree.id
                    WHERE t.deleted_at IS NULL
                )
                SELECT id FROM tree
                """,
                tagIds.ToArray())
            .ToListAsync(cancellationToken);

        return ids;
    }

    /// <summary>转义 LIKE 通配符，避免用户输入的 % 被当成通配。</summary>
    private static string EscapeLike(string value) =>
        value.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
}

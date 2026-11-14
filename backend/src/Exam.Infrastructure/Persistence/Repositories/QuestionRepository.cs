using Exam.Application.Common.Interfaces;
using Exam.Domain.Catalog;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class QuestionRepository : IQuestionRepository
{
    private readonly AppDbContext _db;

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

    public void Remove(Question question) => _db.Questions.Remove(question);

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
            var tagIds = criteria.IncludeDescendants
                ? await ExpandDescendantsAsync(criteria.TagIds, cancellationToken)
                : criteria.TagIds;

            query = criteria.MatchMode == TagMatchMode.All
                ? query.Where(q => q.Tags.Count(t => tagIds.Contains(t.TagId)) == tagIds.Count)
                : query.Where(q => q.Tags.Any(t => tagIds.Contains(t.TagId)));
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

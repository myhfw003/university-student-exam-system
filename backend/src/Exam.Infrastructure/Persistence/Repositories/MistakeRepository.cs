using Exam.Application.Common.Interfaces;
using Exam.Domain.Catalog;
using Exam.Domain.Learning;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class MistakeRepository : IMistakeRepository
{
    private readonly AppDbContext _db;

    public MistakeRepository(AppDbContext db) => _db = db;

    public Task<Mistake?> GetAsync(
        long userId,
        long questionId,
        CancellationToken cancellationToken = default) =>
        _db.Set<Mistake>()
            .FirstOrDefaultAsync(
                m => m.UserId == userId && m.QuestionId == questionId,
                cancellationToken);

    public async Task<IReadOnlyList<Mistake>> SearchAsync(
        MistakeSearchCriteria criteria,
        int skip,
        int take,
        CancellationToken cancellationToken = default) =>
        await Apply(criteria)
            .OrderByDescending(m => m.LastWrongAt)
            .ThenByDescending(m => m.Id)
            .Skip(skip)
            .Take(take)
            .ToListAsync(cancellationToken);

    public Task<int> CountAsync(
        MistakeSearchCriteria criteria,
        CancellationToken cancellationToken = default) =>
        Apply(criteria).CountAsync(cancellationToken);

    /// <summary>把查询条件翻译成数据库过滤。</summary>
    private IQueryable<Mistake> Apply(MistakeSearchCriteria criteria)
    {
        IQueryable<Mistake> query = _db.Set<Mistake>()
            .Where(m => m.UserId == criteria.UserId);

        // 已掌握的默认不显示——错题本是还没解决的问题清单。
        if (!criteria.IncludeResolved)
        {
            query = query.Where(m => m.ResolvedAt == null);
        }

        if (criteria.From is { } from)
        {
            query = query.Where(m => m.LastWrongAt >= from);
        }

        if (criteria.To is { } to)
        {
            query = query.Where(m => m.LastWrongAt <= to);
        }

        if (criteria.QuestionType is { } type)
        {
            var questionIds = _db.Set<Question>()
                .Where(q => q.Type == type)
                .Select(q => q.Id);

            query = query.Where(m => questionIds.Contains(m.QuestionId));
        }

        // 标签集合非空即可：空集合（标签不存在）匹配不到任何题。
        if (criteria.TagIds is { } tagIds)
        {
            var taggedQuestionIds = _db.Set<QuestionTag>()
                .Where(qt => tagIds.Contains(qt.TagId))
                .Select(qt => qt.QuestionId);

            query = query.Where(m => taggedQuestionIds.Contains(m.QuestionId));
        }

        return query;
    }

    public async Task AddAsync(Mistake mistake, CancellationToken cancellationToken = default) =>
        await _db.Set<Mistake>().AddAsync(mistake, cancellationToken);

    public void Update(Mistake mistake) => _db.Set<Mistake>().Update(mistake);
}

using Exam.Application.Common.Interfaces;
using Exam.Domain.Grading;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class ReviewTaskRepository : IReviewTaskRepository
{
    private readonly AppDbContext _db;

    public ReviewTaskRepository(AppDbContext db) => _db = db;

    public Task<ReviewTask?> GetByIdAsync(long id, CancellationToken cancellationToken = default) =>
        _db.Set<ReviewTask>().FirstOrDefaultAsync(t => t.Id == id, cancellationToken);

    public async Task<IReadOnlyList<ReviewTask>> SearchAsync(
        ReviewTaskSearchCriteria criteria,
        int skip,
        int take,
        CancellationToken cancellationToken = default) =>
        await Apply(criteria)
            .OrderBy(t => t.CreatedAt)
            .ThenBy(t => t.Id)
            .Skip(skip)
            .Take(take)
            .ToListAsync(cancellationToken);

    public Task<int> CountAsync(
        ReviewTaskSearchCriteria criteria,
        CancellationToken cancellationToken = default) =>
        Apply(criteria).CountAsync(cancellationToken);

    /// <summary>把查询条件翻译成数据库过滤。</summary>
    private IQueryable<ReviewTask> Apply(ReviewTaskSearchCriteria criteria)
    {
        IQueryable<ReviewTask> query = _db.Set<ReviewTask>();

        if (criteria.Status is not null)
        {
            query = query.Where(t => t.Status == criteria.Status.Value);
        }

        if (criteria.ExamSessionId is not null)
        {
            query = query.Where(t => t.ExamSessionId == criteria.ExamSessionId.Value);
        }

        if (criteria.QuestionId is not null)
        {
            query = query.Where(t => t.QuestionId == criteria.QuestionId.Value);
        }

        if (criteria.AssigneeId is not null)
        {
            query = query.Where(t => t.AssigneeId == criteria.AssigneeId.Value);
        }

        return query;
    }

    /// <summary>
    /// 取回相邻任务。用窗口函数一次算完，避免把整个队列拉出来。
    /// </summary>
    public async Task<(long? PreviousId, long? NextId)> GetNeighborIdsAsync(
        long taskId,
        ReviewTaskSearchCriteria criteria,
        CancellationToken cancellationToken = default)
    {
        var filtered = Apply(criteria);

        var current = await _db.Set<ReviewTask>()
            .Where(t => t.Id == taskId)
            .Select(t => new { t.Id, t.CreatedAt })
            .FirstOrDefaultAsync(cancellationToken);

        if (current is null)
        {
            return (null, null);
        }

        // 队列顺序：创建时间、主键。相邻即「创建时间更早且同刻主键更小 / 更晚且同刻主键更大」。
        var previous = await filtered
            .Where(t => t.CreatedAt < current.CreatedAt
                || (t.CreatedAt == current.CreatedAt && t.Id < current.Id))
            .OrderByDescending(t => t.CreatedAt)
            .ThenByDescending(t => t.Id)
            .Select(t => t.Id)
            .FirstOrDefaultAsync(cancellationToken);

        var next = await filtered
            .Where(t => t.CreatedAt > current.CreatedAt
                || (t.CreatedAt == current.CreatedAt && t.Id > current.Id))
            .OrderBy(t => t.CreatedAt)
            .ThenBy(t => t.Id)
            .Select(t => t.Id)
            .FirstOrDefaultAsync(cancellationToken);

        return (previous == 0 ? null : previous, next == 0 ? null : next);
    }

    public async Task AddRangeAsync(
        IReadOnlyCollection<ReviewTask> tasks,
        CancellationToken cancellationToken = default)
    {
        if (tasks.Count == 0)
        {
            return;
        }

        await _db.Set<ReviewTask>().AddRangeAsync(tasks, cancellationToken);
    }

    public void Update(ReviewTask task) => _db.Set<ReviewTask>().Update(task);
}

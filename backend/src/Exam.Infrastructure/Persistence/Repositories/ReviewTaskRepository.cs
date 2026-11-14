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
        ReviewTaskStatus? status,
        long? examSessionId,
        long? assigneeId,
        int skip,
        int take,
        CancellationToken cancellationToken = default)
    {
        IQueryable<ReviewTask> query = _db.Set<ReviewTask>();

        if (status is not null)
        {
            query = query.Where(t => t.Status == status.Value);
        }

        if (examSessionId is not null)
        {
            query = query.Where(t => t.ExamSessionId == examSessionId.Value);
        }

        if (assigneeId is not null)
        {
            query = query.Where(t => t.AssigneeId == assigneeId.Value);
        }

        return await query
            .OrderBy(t => t.CreatedAt)
            .ThenBy(t => t.Id)
            .Skip(skip)
            .Take(take)
            .ToListAsync(cancellationToken);
    }

    public Task<int> CountAsync(
        ReviewTaskStatus? status,
        long? examSessionId,
        long? assigneeId,
        CancellationToken cancellationToken = default)
    {
        IQueryable<ReviewTask> query = _db.Set<ReviewTask>();

        if (status is not null)
        {
            query = query.Where(t => t.Status == status.Value);
        }

        if (examSessionId is not null)
        {
            query = query.Where(t => t.ExamSessionId == examSessionId.Value);
        }

        if (assigneeId is not null)
        {
            query = query.Where(t => t.AssigneeId == assigneeId.Value);
        }

        return query.CountAsync(cancellationToken);
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

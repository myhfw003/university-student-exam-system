using Exam.Application.Common.Interfaces;
using Exam.Domain.Delivery;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class ExamSessionRepository : IExamSessionRepository
{
    private readonly AppDbContext _db;

    public ExamSessionRepository(AppDbContext db) => _db = db;

    public Task<ExamSession?> GetByIdAsync(long id, CancellationToken cancellationToken = default) =>
        _db.Set<ExamSession>()
            .FirstOrDefaultAsync(s => s.Id == id, cancellationToken);

    public async Task<IReadOnlyList<ExamSession>> ListAsync(
        ExamSessionStatus? status,
        string? keyword,
        CancellationToken cancellationToken = default)
    {
        IQueryable<ExamSession> query = _db.Set<ExamSession>().AsNoTracking();

        if (status is not null)
        {
            query = query.Where(s => s.Status == status.Value);
        }

        if (!string.IsNullOrWhiteSpace(keyword))
        {
            var pattern = $"%{keyword.Trim()}%";
            query = query.Where(s => EF.Functions.ILike(s.Name, pattern));
        }

        return await query
            .OrderBy(s => s.OpenAt)
            .ThenBy(s => s.Id)
            .ToListAsync(cancellationToken);
    }

    public Task<int> CountAsync(
        ExamSessionStatus? status,
        string? keyword,
        CancellationToken cancellationToken = default)
    {
        IQueryable<ExamSession> query = _db.Set<ExamSession>();

        if (status is not null)
        {
            query = query.Where(s => s.Status == status.Value);
        }

        if (!string.IsNullOrWhiteSpace(keyword))
        {
            var pattern = $"%{keyword.Trim()}%";
            query = query.Where(s => EF.Functions.ILike(s.Name, pattern));
        }

        return query.CountAsync(cancellationToken);
    }

    public async Task AddAsync(ExamSession session, CancellationToken cancellationToken = default) =>
        await _db.Set<ExamSession>().AddAsync(session, cancellationToken);

    public void Update(ExamSession session) => _db.Set<ExamSession>().Update(session);

    public void Remove(ExamSession session) => _db.Set<ExamSession>().Remove(session);
}

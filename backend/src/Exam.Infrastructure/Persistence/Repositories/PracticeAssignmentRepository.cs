using Exam.Application.Common.Interfaces;
using Exam.Domain.Learning;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class PracticeAssignmentRepository : IPracticeAssignmentRepository
{
    private readonly AppDbContext _db;

    public PracticeAssignmentRepository(AppDbContext db) => _db = db;

    public Task<PracticeAssignment?> GetByIdAsync(long id, CancellationToken cancellationToken = default) =>
        _db.Set<PracticeAssignment>().FirstOrDefaultAsync(a => a.Id == id, cancellationToken);

    public async Task<IReadOnlyList<PracticeAssignment>> GetByIdsAsync(
        IReadOnlyCollection<long> ids,
        CancellationToken cancellationToken = default)
    {
        if (ids.Count == 0)
        {
            return [];
        }

        return await _db.Set<PracticeAssignment>()
            .AsNoTracking()
            .Where(a => ids.Contains(a.Id))
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<PracticeAssignment>> ListPublishedOpenAsync(
        DateTimeOffset now,
        CancellationToken cancellationToken = default) =>
        await _db.Set<PracticeAssignment>()
            .AsNoTracking()
            .Where(a => a.Status == PracticeAssignmentStatus.Published)
            .Where(a => a.OpenAt == null || a.OpenAt <= now)
            .Where(a => a.CloseAt == null || a.CloseAt >= now)
            .OrderBy(a => a.PublishedAt)
            .ThenBy(a => a.Id)
            .ToListAsync(cancellationToken);

    public async Task AddAsync(PracticeAssignment assignment, CancellationToken cancellationToken = default) =>
        await _db.Set<PracticeAssignment>().AddAsync(assignment, cancellationToken);
}

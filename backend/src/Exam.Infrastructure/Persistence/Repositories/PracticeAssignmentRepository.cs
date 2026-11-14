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

    public async Task AddAsync(PracticeAssignment assignment, CancellationToken cancellationToken = default) =>
        await _db.Set<PracticeAssignment>().AddAsync(assignment, cancellationToken);
}

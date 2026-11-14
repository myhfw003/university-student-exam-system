using Exam.Application.Common.Interfaces;
using Exam.Domain.Catalog;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class QuestionBankRepository : IQuestionBankRepository
{
    private readonly AppDbContext _db;

    public QuestionBankRepository(AppDbContext db) => _db = db;

    public Task<QuestionBank?> GetByIdAsync(long id, CancellationToken cancellationToken = default) =>
        _db.QuestionBanks
            .Include(b => b.Items)
            .FirstOrDefaultAsync(b => b.Id == id, cancellationToken);

    public Task<QuestionBank?> GetByNameAsync(string name, CancellationToken cancellationToken = default) =>
        _db.QuestionBanks
            .Include(b => b.Items)
            .FirstOrDefaultAsync(b => b.Name == name, cancellationToken);

    public async Task<IReadOnlyList<QuestionBank>> ListAsync(CancellationToken cancellationToken = default) =>
        await _db.QuestionBanks
            .AsNoTracking()
            .Include(b => b.Items)
            .OrderBy(b => b.Name)
            .ToListAsync(cancellationToken);

    public async Task AddAsync(QuestionBank bank, CancellationToken cancellationToken = default) =>
        await _db.QuestionBanks.AddAsync(bank, cancellationToken);

    public void Update(QuestionBank bank) => _db.QuestionBanks.Update(bank);

    public void Remove(QuestionBank bank) => _db.QuestionBanks.Remove(bank);
}

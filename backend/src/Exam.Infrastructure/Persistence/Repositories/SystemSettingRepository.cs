using Exam.Application.Common.Interfaces;
using Exam.Domain.Settings;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class SystemSettingRepository : ISystemSettingRepository
{
    private readonly AppDbContext _db;

    public SystemSettingRepository(AppDbContext db) => _db = db;

    public Task<SystemSetting?> GetAsync(string key, CancellationToken cancellationToken = default) =>
        _db.Set<SystemSetting>()
            .FirstOrDefaultAsync(s => s.Key == key, cancellationToken);

    public async Task<IReadOnlyList<SystemSetting>> ListAsync(CancellationToken cancellationToken = default) =>
        await _db.Set<SystemSetting>()
            .AsNoTracking()
            .OrderBy(s => s.Key)
            .ToListAsync(cancellationToken);

    public async Task AddAsync(SystemSetting setting, CancellationToken cancellationToken = default) =>
        await _db.Set<SystemSetting>().AddAsync(setting, cancellationToken);

    public void Update(SystemSetting setting) => _db.Set<SystemSetting>().Update(setting);
}

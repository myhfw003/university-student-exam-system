using Exam.Application.Common.Interfaces;
using Exam.Domain.Identity;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class UserTagRepository : IUserTagRepository
{
    private readonly AppDbContext _db;

    public UserTagRepository(AppDbContext db) => _db = db;

    public async Task AddAsync(UserTag userTag, CancellationToken cancellationToken = default) =>
        await _db.UserTags.AddAsync(userTag, cancellationToken);

    public void Remove(UserTag userTag) => _db.UserTags.Remove(userTag);

    public async Task<IReadOnlyList<UserTag>> GetByUserAsync(
        long userId,
        CancellationToken cancellationToken = default) =>
        await _db.UserTags
            .Where(x => x.UserId == userId)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<long>> GetUserIdsByTagAsync(
        long tagId,
        CancellationToken cancellationToken = default) =>
        await _db.UserTags
            .AsNoTracking()
            .Where(x => x.TagId == tagId)
            .Select(x => x.UserId)
            .ToListAsync(cancellationToken);

    public Task<int> CountByTagAsync(long tagId, CancellationToken cancellationToken = default) =>
        _db.UserTags.CountAsync(x => x.TagId == tagId, cancellationToken);
}

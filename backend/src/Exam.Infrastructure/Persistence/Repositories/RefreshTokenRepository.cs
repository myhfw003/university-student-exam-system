using Exam.Application.Common.Interfaces;
using Exam.Domain.Identity;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class RefreshTokenRepository : IRefreshTokenRepository
{
    private readonly AppDbContext _db;

    public RefreshTokenRepository(AppDbContext db) => _db = db;

    public Task<RefreshToken?> GetByHashAsync(string tokenHash, CancellationToken cancellationToken = default) =>
        _db.RefreshTokens.FirstOrDefaultAsync(x => x.TokenHash == tokenHash, cancellationToken);

    public async Task<IReadOnlyList<RefreshToken>> GetFamilyAsync(
        Guid familyId,
        CancellationToken cancellationToken = default) =>
        await _db.RefreshTokens
            .Where(x => x.FamilyId == familyId)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<RefreshToken>> GetByUserAsync(
        long userId,
        CancellationToken cancellationToken = default) =>
        await _db.RefreshTokens
            .Where(x => x.UserId == userId)
            .ToListAsync(cancellationToken);

    public async Task AddAsync(RefreshToken token, CancellationToken cancellationToken = default) =>
        await _db.RefreshTokens.AddAsync(token, cancellationToken);

    public void Update(RefreshToken token) => _db.RefreshTokens.Update(token);

    /// <summary>
    /// 吊销用户的全部有效令牌。账号被禁用或密码被重置时调用，
    /// 让旧令牌立刻失效而不是等其自然过期。
    /// </summary>
    public async Task<int> RevokeAllForUserAsync(
        long userId,
        RefreshTokenRevokeReason reason,
        DateTimeOffset now,
        CancellationToken cancellationToken = default)
    {
        var tokens = await _db.RefreshTokens
            .Where(x => x.UserId == userId && x.RevokedAt == null)
            .ToListAsync(cancellationToken);

        foreach (var token in tokens)
        {
            token.Revoke(reason, now);
        }

        return tokens.Count;
    }
}

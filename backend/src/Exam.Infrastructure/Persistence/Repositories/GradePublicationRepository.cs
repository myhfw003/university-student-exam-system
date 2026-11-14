using Exam.Application.Common.Interfaces;
using Exam.Domain.Grading;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

public sealed class GradePublicationRepository : IGradePublicationRepository
{
    private readonly AppDbContext _db;

    public GradePublicationRepository(AppDbContext db) => _db = db;

    public async Task AddAsync(GradePublication publication, CancellationToken cancellationToken = default) =>
        await _db.Set<GradePublication>().AddAsync(publication, cancellationToken);

    public async Task<IReadOnlyList<GradePublication>> ListBySessionAsync(
        long examSessionId,
        CancellationToken cancellationToken = default) =>
        await _db.Set<GradePublication>()
            .AsNoTracking()
            .Where(p => p.ExamSessionId == examSessionId)
            .OrderBy(p => p.PublishedAt)
            .ThenBy(p => p.Id)
            .ToListAsync(cancellationToken);

    /// <summary>
    /// 取回覆盖某份作答的最新一条发布记录。
    /// <para>
    /// 一场考试的发布记录就那么几条，取回来在内存里挑就行——数组包含让数据库去算反而绕。
    /// </para>
    /// </summary>
    public async Task<GradePublication?> GetCoveringAsync(
        long examSessionId,
        long attemptId,
        CancellationToken cancellationToken = default)
    {
        var publications = await ListBySessionAsync(examSessionId, cancellationToken);

        return publications
            .Where(p => p.Covers(attemptId))
            .OrderByDescending(p => p.PublishedAt)
            .ThenByDescending(p => p.Id)
            .FirstOrDefault();
    }
}

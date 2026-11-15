using Exam.Application.Common.Interfaces;
using Exam.Domain.Analytics;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

/// <summary>
/// 统计读模型存取。
/// <para>
/// 读模型是**整体替换**的：重算一次就把这场考试的旧行删掉重写，
/// 免得半新半旧的数据混在一起。
/// </para>
/// </summary>
public sealed class ExamStatisticRepository : IExamStatisticRepository
{
    private readonly AppDbContext _db;

    public ExamStatisticRepository(AppDbContext db) => _db = db;

    public Task<ExamStatistic?> GetExamStatisticAsync(
        long examSessionId,
        CancellationToken cancellationToken = default) =>
        _db.Set<ExamStatistic>()
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.ExamSessionId == examSessionId, cancellationToken);

    public async Task<IReadOnlyList<QuestionStatistic>> ListQuestionStatisticsAsync(
        long examSessionId,
        CancellationToken cancellationToken = default) =>
        await _db.Set<QuestionStatistic>()
            .AsNoTracking()
            .Where(s => s.ExamSessionId == examSessionId)
            .OrderBy(s => s.QuestionId)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<TypeStatistic>> ListTypeStatisticsAsync(
        long examSessionId,
        CancellationToken cancellationToken = default) =>
        await _db.Set<TypeStatistic>()
            .AsNoTracking()
            .Where(s => s.ExamSessionId == examSessionId)
            .OrderBy(s => s.QuestionType)
            .ToListAsync(cancellationToken);

    public async Task ReplaceAsync(
        long examSessionId,
        ExamStatistic examStatistic,
        IReadOnlyList<QuestionStatistic> questionStatistics,
        IReadOnlyList<TypeStatistic> typeStatistics,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);

        // 同一场考试的重算串行执行：并发重算不该互相踩。
        await _db.Database.ExecuteSqlRawAsync(
            "SELECT pg_advisory_xact_lock(hashtext({0}))",
            new object[] { $"exam-statistic:{examSessionId}" },
            cancellationToken);

        await _db.Database.ExecuteSqlRawAsync(
            "DELETE FROM analytics.question_statistic WHERE exam_session_id = {0}",
            new object[] { examSessionId },
            cancellationToken);

        await _db.Database.ExecuteSqlRawAsync(
            "DELETE FROM analytics.type_statistic WHERE exam_session_id = {0}",
            new object[] { examSessionId },
            cancellationToken);

        await _db.Database.ExecuteSqlRawAsync(
            "DELETE FROM analytics.exam_statistic WHERE exam_session_id = {0}",
            new object[] { examSessionId },
            cancellationToken);

        await _db.Set<ExamStatistic>().AddAsync(examStatistic, cancellationToken);
        await _db.Set<QuestionStatistic>().AddRangeAsync(questionStatistics, cancellationToken);
        await _db.Set<TypeStatistic>().AddRangeAsync(typeStatistics, cancellationToken);

        await _db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }
}

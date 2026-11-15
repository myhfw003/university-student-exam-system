using Exam.Application.Analytics.Contracts;
using Exam.Application.Common.Interfaces;
using Exam.Domain.Delivery;
using Exam.Domain.Grading;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Infrastructure.Persistence.Repositories;

/// <summary>
/// 统计用的原始数据来源。
/// <para>
/// 只取事实，不做统计口径的判断。口径在应用层，
/// 这样调整口径不必改查询。
/// </para>
/// </summary>
public sealed class ExamStatisticSource : IExamStatisticSource
{
    private readonly AppDbContext _db;

    public ExamStatisticSource(AppDbContext db) => _db = db;

    public async Task<IReadOnlyList<ExamAttemptFact>> ListAttemptFactsAsync(
        long examSessionId,
        CancellationToken cancellationToken = default) =>
        await _db.Set<Attempt>()
            .AsNoTracking()
            .Where(a => a.ExamSessionId == examSessionId)
            .Select(a => new ExamAttemptFact(
                a.Id,
                a.UserId,
                a.AttemptNo,
                a.Status == AttemptStatus.Submitted
                    || a.Status == AttemptStatus.AutoSubmitted
                    || a.Status == AttemptStatus.ForceSubmitted,
                a.SubmittedAt))
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<ExamScoreFact>> ListScoreFactsAsync(
        long examSessionId,
        CancellationToken cancellationToken = default)
    {
        var answers = _db.Set<Answer>().AsNoTracking();

        var rows = await (
            from result in _db.Set<ScoreResult>().AsNoTracking()
            join attempt in _db.Set<Attempt>().AsNoTracking() on result.AttemptId equals attempt.Id
            where attempt.ExamSessionId == examSessionId
            from answer in answers
                .Where(a => a.AttemptId == result.AttemptId && a.QuestionId == result.QuestionId)
                .DefaultIfEmpty()
            select new
            {
                result.AttemptId,
                result.QuestionId,
                result.Score,
                result.MaxScore,
                IsAnswered = answer != null && !answer.IsBlank,
            })
            .ToListAsync(cancellationToken);

        return rows
            .Select(r => new ExamScoreFact(
                r.AttemptId,
                r.QuestionId,
                r.Score.Value,
                r.MaxScore.Value,
                r.IsAnswered))
            .ToList();
    }

    public async Task<DateTimeOffset?> GetLatestChangeAsync(
        long examSessionId,
        CancellationToken cancellationToken = default)
    {
        var attemptChange = await _db.Set<Attempt>()
            .AsNoTracking()
            .Where(a => a.ExamSessionId == examSessionId)
            .Select(a => (DateTimeOffset?)(a.UpdatedAt ?? a.CreatedAt))
            .MaxAsync(cancellationToken);

        var attemptIds = await _db.Set<Attempt>()
            .AsNoTracking()
            .Where(a => a.ExamSessionId == examSessionId)
            .Select(a => a.Id)
            .ToListAsync(cancellationToken);

        if (attemptIds.Count == 0)
        {
            return attemptChange;
        }

        var scoreChange = await _db.Set<ScoreResult>()
            .AsNoTracking()
            .Where(r => attemptIds.Contains(r.AttemptId))
            .Select(r => (DateTimeOffset?)(r.UpdatedAt ?? r.CreatedAt))
            .MaxAsync(cancellationToken);

        if (attemptChange is null)
        {
            return scoreChange;
        }

        return scoreChange is null ? attemptChange : (attemptChange > scoreChange ? attemptChange : scoreChange);
    }

    public async Task<IReadOnlyList<long>> ListSessionIdsByQuestionAsync(
        long questionId,
        CancellationToken cancellationToken = default) =>
        await _db.Set<ScoreResult>()
            .AsNoTracking()
            .Where(r => r.QuestionId == questionId)
            .Join(
                _db.Set<Attempt>().AsNoTracking(),
                r => r.AttemptId,
                a => a.Id,
                (r, a) => a.ExamSessionId)
            .Where(sessionId => sessionId != null)
            .Select(sessionId => sessionId!.Value)
            .Distinct()
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<long>> ListSessionIdsWithAttemptsAsync(
        CancellationToken cancellationToken = default) =>
        await _db.Set<Attempt>()
            .AsNoTracking()
            .Where(a => a.ExamSessionId != null)
            .Select(a => a.ExamSessionId!.Value)
            .Distinct()
            .ToListAsync(cancellationToken);
}

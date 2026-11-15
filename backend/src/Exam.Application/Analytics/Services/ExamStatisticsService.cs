using Exam.Application.Analytics.Contracts;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Domain.Analytics;
using Exam.Domain.Catalog;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Application.Analytics.Services;

/// <summary>
/// 成绩统计重算。
/// <para>
/// **口径**（与前端原型、接口文档一致）：
/// </para>
/// <list type="bullet">
/// <item>统计对象是**已交卷**的作答；重考按「最后一次」或「最好一次」取一份（看试卷设置）。</item>
/// <item>应考人数 = 名单上的考生 ∪ 进过考场的考生；缺考 = 应考 − 交卷。</item>
/// <item>及格线优先用试卷设置的及格分，没设置才按 60% 得分率兜底；优秀线按 85% 得分率。</item>
/// <item>分数段按**得分率**分档，满分是这场考试的试卷总分。</item>
/// <item>逐题与题型只统计**真正作答（非空白）**的人次：空白答案不拉低平均分。</item>
/// </list>
/// </summary>
public sealed class ExamStatisticsService
{
    private readonly IExamStatisticSource _source;
    private readonly IExamStatisticRepository _readModel;
    private readonly IExamSessionRepository _sessions;
    private readonly IPaperSnapshotRepository _snapshots;
    private readonly IPaperRepository _papers;
    private readonly IExamParticipantRepository _participants;
    private readonly IUserRepository _users;
    private readonly IQuestionRepository _questions;
    private readonly IClock _clock;

    public ExamStatisticsService(
        IExamStatisticSource source,
        IExamStatisticRepository readModel,
        IExamSessionRepository sessions,
        IPaperSnapshotRepository snapshots,
        IPaperRepository papers,
        IExamParticipantRepository participants,
        IUserRepository users,
        IQuestionRepository questions,
        IClock clock)
    {
        _source = source;
        _readModel = readModel;
        _sessions = sessions;
        _snapshots = snapshots;
        _papers = papers;
        _participants = participants;
        _users = users;
        _questions = questions;
        _clock = clock;
    }

    /// <summary>读模型是否落后于原始数据。</summary>
    public async Task<bool> IsStaleAsync(long examSessionId, CancellationToken cancellationToken = default)
    {
        var statistic = await _readModel.GetExamStatisticAsync(examSessionId, cancellationToken);
        if (statistic is null)
        {
            return true;
        }

        var latest = await _source.GetLatestChangeAsync(examSessionId, cancellationToken);
        return latest is not null && latest.Value > statistic.UpdatedAt;
    }

    /// <summary>重算某一场考试并写入读模型。</summary>
    public async Task RefreshAsync(long examSessionId, CancellationToken cancellationToken = default)
    {
        var computation = await ComputeAsync(examSessionId, cancellationToken);

        await _readModel.ReplaceAsync(
            examSessionId,
            computation.ExamStatistic,
            computation.Questions,
            computation.Types,
            cancellationToken);
    }

    /// <summary>
    /// 按原始作答数据算出一场考试的统计。纯计算，不落库。
    /// </summary>
    public async Task<ExamStatisticComputation> ComputeAsync(
        long examSessionId,
        CancellationToken cancellationToken = default)
    {
        var session = await _sessions.GetByIdAsync(examSessionId, cancellationToken)
            ?? throw new NotFoundException("考试场次不存在。");

        if (session.SnapshotId is null)
        {
            throw new BusinessRuleException("考试场次尚未发布，暂无统计数据。");
        }

        var snapshot = await _snapshots.GetByIdAsync(session.SnapshotId.Value, cancellationToken)
            ?? throw new NotFoundException("试卷快照不存在。");

        var paper = await _papers.GetByIdAsync(session.PaperId, cancellationToken);
        var attempts = await _source.ListAttemptFactsAsync(examSessionId, cancellationToken);
        var facts = await _source.ListScoreFactsAsync(examSessionId, cancellationToken);
        var participants = await _participants.ListBySessionAsync(examSessionId, cancellationToken);

        var now = _clock.UtcNow;

        // 每份作答的总分与总满分。空白答案按零分计入总分，不计入逐题分母。
        var totalsByAttempt = facts
            .GroupBy(f => f.AttemptId)
            .ToDictionary(
                g => g.Key,
                g => (Score: g.Sum(f => f.Score), MaxScore: g.Sum(f => f.MaxScore)));

        var selected = SelectFinalAttempts(
            attempts.Where(a => a.IsSubmitted).ToList(),
            totalsByAttempt,
            paper?.RetakeKeepsBest ?? false);

        var selectedIds = selected.Select(a => a.AttemptId).ToHashSet();
        var selectedFacts = facts.Where(f => selectedIds.Contains(f.AttemptId)).ToList();

        // 试卷总分：整场考试的满分，阈值与分档都以它为基准。
        var paperTotalMax = snapshot.Items.Sum(i => i.Score.Value);

        var participantUserIds = participants
            .Select(p => p.UserId)
            .Concat(attempts.Select(a => a.UserId))
            .Distinct()
            .ToList();

        var participantCount = participantUserIds.Count;
        var submittedCount = selected.Count;
        var absentCount = Math.Max(0, participantCount - submittedCount);

        var totalScores = selected
            .Select(a => totalsByAttempt.TryGetValue(a.AttemptId, out var t) ? t.Score : 0m)
            .ToList();

        var scoreRates = totalScores
            .Select(s => AnalyticsRules.ScoreRate(s, paperTotalMax))
            .ToList();

        var passThreshold = AnalyticsRules.PassThreshold(paperTotalMax, paper?.PassScore?.Value);
        var excellentThreshold = AnalyticsRules.ExcellentThreshold(paperTotalMax);

        var passCount = totalScores.Count(s => AnalyticsRules.IsPass(s, passThreshold));
        var excellentCount = totalScores.Count(s => AnalyticsRules.IsExcellent(s, excellentThreshold));

        var examStatistic = ExamStatistic.Create(
            examSessionId,
            participantCount,
            submittedCount,
            absentCount,
            totalScores.Count > 0 ? Round(totalScores.Average(), 2) : null,
            totalScores.Count > 0 ? Round(totalScores.Max(), 2) : null,
            totalScores.Count > 0 ? Round(totalScores.Min(), 2) : null,
            submittedCount > 0 ? Round((decimal)passCount / submittedCount, 4) : null,
            submittedCount > 0 ? Round((decimal)excellentCount / submittedCount, 4) : null,
            AnalyticsRules.CountByBucket(scoreRates),
            now);

        var questionStatistics = BuildQuestionStatistics(examSessionId, snapshot, selectedFacts, now);
        var typeStatistics = BuildTypeStatistics(examSessionId, snapshot, selectedFacts, now);

        return new ExamStatisticComputation(examStatistic, questionStatistics, typeStatistics);
    }

    /// <summary>
    /// 逐人成绩明细：每位考生的客观分、主观分与总分。
    /// <para>按总分从高到低排；与场次统计同一套取卷规则（重考取最后一次或最好一次）。</para>
    /// </summary>
    public async Task<IReadOnlyList<StudentStatisticDto>> BuildRosterAsync(
        long examSessionId,
        CancellationToken cancellationToken = default)
    {
        var session = await _sessions.GetByIdAsync(examSessionId, cancellationToken)
            ?? throw new NotFoundException("考试场次不存在。");

        if (session.SnapshotId is null)
        {
            throw new BusinessRuleException("考试场次尚未发布，暂无成绩明细。");
        }

        var snapshot = await _snapshots.GetByIdAsync(session.SnapshotId.Value, cancellationToken)
            ?? throw new NotFoundException("试卷快照不存在。");

        var paper = await _papers.GetByIdAsync(session.PaperId, cancellationToken);
        var attempts = await _source.ListAttemptFactsAsync(examSessionId, cancellationToken);
        var facts = await _source.ListScoreFactsAsync(examSessionId, cancellationToken);

        var totalsByAttempt = facts
            .GroupBy(f => f.AttemptId)
            .ToDictionary(
                g => g.Key,
                g => (Score: g.Sum(f => f.Score), MaxScore: g.Sum(f => f.MaxScore)));

        var selected = SelectFinalAttempts(
            attempts.Where(a => a.IsSubmitted).ToList(),
            totalsByAttempt,
            paper?.RetakeKeepsBest ?? false);

        // 客观题与主观题分开计分：前端要分开展示客观分与主观分。
        var objectiveQuestionIds = snapshot.Items
            .Where(i => (QuestionTypes.FromStorage(i.QuestionType) ?? QuestionType.Single).IsObjective())
            .Select(i => i.QuestionId)
            .ToHashSet();

        var rows = selected
            .Select(attempt =>
            {
                var attemptFacts = facts.Where(f => f.AttemptId == attempt.AttemptId).ToList();

                return new RosterRow(
                    attempt.UserId,
                    attempt.SubmittedAt,
                    attemptFacts.Where(f => objectiveQuestionIds.Contains(f.QuestionId)).Sum(f => f.Score),
                    attemptFacts.Where(f => !objectiveQuestionIds.Contains(f.QuestionId)).Sum(f => f.Score),
                    attemptFacts.Sum(f => f.Score),
                    attemptFacts.Sum(f => f.MaxScore));
            })
            .ToList();

        var users = await _users.GetByIdsAsync(rows.Select(r => r.UserId).Distinct().ToList(), cancellationToken);
        var userById = users.ToDictionary(u => u.Id);

        return rows
            .OrderByDescending(r => r.TotalScore)
            .ThenBy(r => r.UserId)
            .Select(r =>
            {
                userById.TryGetValue(r.UserId, out var user);

                return new StudentStatisticDto(
                    r.UserId,
                    user?.Username ?? string.Empty,
                    user?.DisplayName ?? string.Empty,
                    Round(r.ObjectiveScore, 2),
                    Round(r.SubjectiveScore, 2),
                    Round(r.TotalScore, 2),
                    Round(r.TotalMaxScore, 2),
                    Round(AnalyticsRules.ScoreRate(r.TotalScore, r.TotalMaxScore), 4),
                    r.SubmittedAt);
            })
            .ToList();
    }

    /// <summary>
    /// 一道题在全部场次里的逐题正确率。
    /// <para>逐场次取读模型里的逐题统计再汇总；读模型落后于原始作答数据的场次会先重算。</para>
    /// </summary>
    public async Task<QuestionStatisticsResponse?> BuildQuestionSummaryAsync(
        long questionId,
        CancellationToken cancellationToken = default)
    {
        var question = await _questions.GetByIdAsync(questionId, cancellationToken);
        if (question is null)
        {
            return null;
        }

        var sessionIds = await _source.ListSessionIdsByQuestionAsync(questionId, cancellationToken);
        var sessions = new List<QuestionSessionStatisticDto>();

        var totalAnswered = 0;
        var totalCorrect = 0;
        var totalScoreSum = 0m;
        var totalMaxSum = 0m;
        decimal? maxScore = null;

        foreach (var sessionId in sessionIds)
        {
            // 逐题正确率必须与原始作答数据一致：读模型落后就先重算。
            if (await IsStaleAsync(sessionId, cancellationToken))
            {
                await RefreshAsync(sessionId, cancellationToken);
            }

            var row = (await _readModel.ListQuestionStatisticsAsync(sessionId, cancellationToken))
                .FirstOrDefault(q => q.QuestionId == questionId);
            if (row is null)
            {
                continue;
            }

            var session = await _sessions.GetByIdAsync(sessionId, cancellationToken);
            if (session is null)
            {
                continue;
            }

            var itemMaxScore = await MaxScoreOfQuestionAsync(session, questionId, cancellationToken);
            if (itemMaxScore is null)
            {
                continue;
            }

            totalAnswered += row.AnsweredCount;
            totalCorrect += row.CorrectCount;
            totalScoreSum += row.ScoreSum;
            totalMaxSum += row.AnsweredCount * itemMaxScore.Value;
            maxScore = maxScore is null || itemMaxScore > maxScore ? itemMaxScore : maxScore;

            sessions.Add(new QuestionSessionStatisticDto(
                sessionId,
                session.Name,
                row.AnsweredCount,
                row.CorrectCount,
                row.AnsweredCount > 0 ? Round((decimal)row.CorrectCount / row.AnsweredCount, 4) : null,
                row.AverageScore,
                row.MasteryRate));
        }

        decimal? correctRate = totalAnswered > 0 ? Round((decimal)totalCorrect / totalAnswered, 4) : null;
        decimal? averageScore = totalAnswered > 0 ? Round(totalScoreSum / totalAnswered, 2) : null;
        decimal? mastery = totalMaxSum > 0m ? Round(totalScoreSum / totalMaxSum, 4) : null;

        return new QuestionStatisticsResponse(
            question.Id,
            question.Code,
            question.Type.ToStorage(),
            question.Type.Label(),
            question.Stem,
            maxScore,
            sessions.Count,
            totalAnswered,
            totalCorrect,
            correctRate,
            averageScore,
            mastery,
            AnalyticsRules.ReviewSuggestion(correctRate, mastery, totalAnswered),
            sessions);
    }

    /// <summary>某场考试里这道题的满分。</summary>
    private async Task<decimal?> MaxScoreOfQuestionAsync(
        Exam.Domain.Delivery.ExamSession session,
        long questionId,
        CancellationToken cancellationToken)
    {
        if (session.SnapshotId is null)
        {
            return null;
        }

        var snapshot = await _snapshots.GetByIdAsync(session.SnapshotId.Value, cancellationToken);
        var item = snapshot?.Items.FirstOrDefault(i => i.QuestionId == questionId);
        return item?.Score.Value;
    }

    /// <summary>逐题统计。卷面上的每一道题都有一行，没人作答的题计数为零。</summary>
    private static IReadOnlyList<QuestionStatistic> BuildQuestionStatistics(
        long examSessionId,
        Exam.Domain.Authoring.PaperSnapshot snapshot,
        IReadOnlyList<ExamScoreFact> facts,
        DateTimeOffset now)
    {
        var factsByQuestion = facts
            .GroupBy(f => f.QuestionId)
            .ToDictionary(g => g.Key, g => g.ToList());

        var result = new List<QuestionStatistic>();

        foreach (var item in snapshot.Items.OrderBy(i => i.SortOrder))
        {
            var answered = factsByQuestion.TryGetValue(item.QuestionId, out var list)
                ? list.Where(f => f.IsAnswered).ToList()
                : [];

            var sumScore = answered.Sum(f => f.Score);
            var sumMax = answered.Sum(f => f.MaxScore);

            result.Add(QuestionStatistic.Create(
                examSessionId,
                item.QuestionId,
                answered.Count,
                answered.Count(f => AnalyticsRules.IsFullMark(f.Score, f.MaxScore)),
                Round(sumScore, 2),
                answered.Count > 0 ? Round(sumScore / answered.Count, 2) : null,
                sumMax > 0m ? Round(sumScore / sumMax, 4) : null,
                now));
        }

        return result;
    }

    /// <summary>题型统计。口径与逐题一致。</summary>
    private static IReadOnlyList<TypeStatistic> BuildTypeStatistics(
        long examSessionId,
        Exam.Domain.Authoring.PaperSnapshot snapshot,
        IReadOnlyList<ExamScoreFact> facts,
        DateTimeOffset now)
    {
        var result = new List<TypeStatistic>();

        var byType = snapshot.Items
            .GroupBy(i => i.QuestionType)
            .OrderBy(g => g.Key, StringComparer.Ordinal);

        foreach (var group in byType)
        {
            var questionIds = group.Select(i => i.QuestionId).ToHashSet();

            var answered = facts
                .Where(f => questionIds.Contains(f.QuestionId) && f.IsAnswered)
                .ToList();

            var sumScore = answered.Sum(f => f.Score);
            var sumMax = answered.Sum(f => f.MaxScore);

            result.Add(TypeStatistic.Create(
                examSessionId,
                group.Key,
                answered.Count,
                answered.Count > 0 ? Round(sumScore / answered.Count, 2) : null,
                sumMax > 0m ? Round(sumScore / sumMax, 4) : null,
                now));
        }

        return result;
    }

    /// <summary>
    /// 选出每位考生的最终作答：默认取最后一次；试卷设了「重考取最好」就取分数最高的一次。
    /// </summary>
    private static IReadOnlyList<ExamAttemptFact> SelectFinalAttempts(
        IReadOnlyList<ExamAttemptFact> submitted,
        IReadOnlyDictionary<long, (decimal Score, decimal MaxScore)> totalsByAttempt,
        bool keepBest)
    {
        return submitted
            .GroupBy(a => a.UserId)
            .Select(group =>
            {
                var ordered = keepBest
                    ? group
                        .OrderByDescending(a => totalsByAttempt.TryGetValue(a.AttemptId, out var t) ? t.Score : 0m)
                        .ThenByDescending(a => a.SubmittedAt)
                        .ThenByDescending(a => a.AttemptNo)
                    : group
                        .OrderByDescending(a => a.SubmittedAt)
                        .ThenByDescending(a => a.AttemptNo);

                return ordered.First();
            })
            .OrderBy(a => a.UserId)
            .ToList();
    }

    private static decimal Round(decimal value, int digits) => Math.Round(value, digits, MidpointRounding.AwayFromZero);

    /// <summary>逐人成绩明细的中间行。</summary>
    private sealed record RosterRow(
        long UserId,
        DateTimeOffset? SubmittedAt,
        decimal ObjectiveScore,
        decimal SubjectiveScore,
        decimal TotalScore,
        decimal TotalMaxScore);
}

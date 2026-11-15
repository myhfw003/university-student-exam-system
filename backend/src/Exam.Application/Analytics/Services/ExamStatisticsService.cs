using Exam.Application.Analytics.Contracts;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Domain.Analytics;
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
    private readonly IClock _clock;

    public ExamStatisticsService(
        IExamStatisticSource source,
        IExamStatisticRepository readModel,
        IExamSessionRepository sessions,
        IPaperSnapshotRepository snapshots,
        IPaperRepository papers,
        IExamParticipantRepository participants,
        IClock clock)
    {
        _source = source;
        _readModel = readModel;
        _sessions = sessions;
        _snapshots = snapshots;
        _papers = papers;
        _participants = participants;
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
}

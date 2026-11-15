using Exam.Application.Common.Interfaces;
using Exam.Application.Delivery.Contracts;
using Exam.Application.Grading.Services;
using Exam.Application.Learning.Contracts;
using Exam.Domain.Catalog;
using Exam.Domain.Delivery;
using Exam.Domain.Grading;
using Exam.Domain.SharedKernel.Abstractions;

namespace Exam.Application.Learning.Services;

/// <summary>
/// 学生工作台汇总。
/// <para>
/// 汇总口径与其它学生端接口一致：**成绩没发布之前，主观题的分不露出来**——
/// 工作台上的成绩趋势与最近成绩跟成绩报告看到的是同一套分。
/// </para>
/// </summary>
public sealed class DashboardService
{
    /// <summary>成绩趋势取最近几场。</summary>
    private const int TrendPointCount = 6;

    /// <summary>最近成绩列几条。</summary>
    private const int RecentResultCount = 10;

    /// <summary>推荐练习列几条。</summary>
    private const int RecommendedPracticeCount = 5;

    /// <summary>错题分布最多扫描多少条错题。</summary>
    private const int MistakeScanLimit = 1000;

    private readonly IExamSessionRepository _sessions;
    private readonly IExamParticipantRepository _participants;
    private readonly IAttemptRepository _attempts;
    private readonly IScoreResultRepository _scoreResults;
    private readonly IGradePublicationRepository _publications;
    private readonly IMistakeRepository _mistakes;
    private readonly IQuestionRepository _questions;
    private readonly ITagRepository _tags;
    private readonly IPaperRepository _papers;
    private readonly IPracticeAssignmentRepository _practices;
    private readonly PracticeVisibilityResolver _practiceVisibility;
    private readonly IClock _clock;

    public DashboardService(
        IExamSessionRepository sessions,
        IExamParticipantRepository participants,
        IAttemptRepository attempts,
        IScoreResultRepository scoreResults,
        IGradePublicationRepository publications,
        IMistakeRepository mistakes,
        IQuestionRepository questions,
        ITagRepository tags,
        IPaperRepository papers,
        IPracticeAssignmentRepository practices,
        PracticeVisibilityResolver practiceVisibility,
        IClock clock)
    {
        _sessions = sessions;
        _participants = participants;
        _attempts = attempts;
        _scoreResults = scoreResults;
        _publications = publications;
        _mistakes = mistakes;
        _questions = questions;
        _tags = tags;
        _papers = papers;
        _practices = practices;
        _practiceVisibility = practiceVisibility;
        _clock = clock;
    }

    /// <summary>汇总某位学生的工作台。</summary>
    public async Task<DashboardSummaryResponse> BuildAsync(long userId, CancellationToken cancellationToken = default)
    {
        var now = _clock.UtcNow;
        var attempts = await _attempts.ListByUserAsync(userId, cancellationToken);
        var submitted = attempts
            .Where(a => a.IsSubmitted)
            .OrderByDescending(a => a.SubmittedAt)
            .ThenByDescending(a => a.Id)
            .ToList();

        var records = await BuildRecordsAsync(submitted, cancellationToken);

        var ongoingExam = await BuildOngoingExamAsync(userId, attempts, now, cancellationToken);
        var (pendingPractices, recommended) = await BuildPracticesAsync(userId, submitted, now, cancellationToken);
        var (pendingMistakes, distribution) = await BuildMistakesAsync(userId, cancellationToken);

        // 学期平均分：所有记录的得分率平均（百分制）。
        decimal? termAverageScore = records.Count > 0
            ? Round(records.Average(r => r.Total > 0m ? r.Score / r.Total * 100m : 0m), 2)
            : null;

        var trend = records
            .Take(TrendPointCount)
            .Reverse()
            .Select(r => new ScoreTrendPointDto(r.Date, r.Score, r.Total))
            .ToList();

        return new DashboardSummaryResponse(
            pendingPractices,
            ongoingExam is null ? 0 : 1,
            termAverageScore,
            pendingMistakes,
            ongoingExam,
            recommended,
            records.Take(RecentResultCount).ToList(),
            trend,
            distribution,
            now);
    }

    /// <summary>成绩记录。考试与练习都算。</summary>
    private async Task<IReadOnlyList<RecentResultDto>> BuildRecordsAsync(
        IReadOnlyList<Exam.Domain.Delivery.Attempt> submitted,
        CancellationToken cancellationToken)
    {
        if (submitted.Count == 0)
        {
            return [];
        }

        var results = await _scoreResults.ListByAttemptsAsync(submitted.Select(a => a.Id).ToList(), cancellationToken);
        var resultsByAttempt = results
            .GroupBy(r => r.AttemptId)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<ScoreResult>)g.ToList());

        var sessionIds = submitted
            .Where(a => a.ExamSessionId != null)
            .Select(a => a.ExamSessionId!.Value)
            .Distinct()
            .ToList();

        var sessions = sessionIds.Count > 0
            ? await _sessions.GetByIdsAsync(sessionIds, cancellationToken)
            : [];
        var sessionById = sessions.ToDictionary(s => s.Id);

        var practiceIds = submitted
            .Where(a => a.PracticeAssignmentId != null)
            .Select(a => a.PracticeAssignmentId!.Value)
            .Distinct()
            .ToList();

        var practices = practiceIds.Count > 0
            ? await _practices.GetByIdsAsync(practiceIds, cancellationToken)
            : [];
        var practiceById = practices.ToDictionary(p => p.Id);

        // 发布记录按场次取一次就够，别一份一份去查。
        var publicationsBySession = new Dictionary<long, IReadOnlyList<GradePublication>>();
        foreach (var sessionId in sessionIds)
        {
            publicationsBySession[sessionId] = await _publications.ListBySessionAsync(sessionId, cancellationToken);
        }

        var records = new List<RecentResultDto>();

        foreach (var attempt in submitted)
        {
            var attemptResults = resultsByAttempt.GetValueOrDefault(attempt.Id, []);
            var pending = AttemptScoreSummaryFactory.IsSubjectivePending(attemptResults);

            // 练习没有成绩发布这回事：自己练的，直接看全部分。
            var visibility = GradeVisibilities.Published;
            if (attempt.ExamSessionId is { } sessionId)
            {
                var publication = publicationsBySession
                    .GetValueOrDefault(sessionId)?
                    .Where(p => p.Covers(attempt.Id))
                    .OrderByDescending(p => p.PublishedAt)
                    .ThenByDescending(p => p.Id)
                    .FirstOrDefault();

                visibility = GradeVisibilityResolver.Resolve(publication, pending);
            }

            var summary = AttemptScoreSummaryFactory.Build(attemptResults, visibility);

            var name = attempt.ExamSessionId is { } examSessionId
                ? sessionById.GetValueOrDefault(examSessionId)?.Name ?? "考试"
                : practiceById.GetValueOrDefault(attempt.PracticeAssignmentId!.Value)?.Title ?? "练习";

            records.Add(new RecentResultDto(
                attempt.Id,
                attempt.TargetType == AttemptTargetType.Exam ? "exam" : "practice",
                name,
                attempt.SubmittedAt ?? attempt.StartedAt ?? DateTimeOffset.MinValue,
                Round(summary.TotalScore, 2),
                Round(summary.TotalMax, 2),
                "done"));
        }

        return records;
    }

    /// <summary>进行中的考试：只算该考生看得见的场次。</summary>
    private async Task<OngoingExamDto?> BuildOngoingExamAsync(
        long userId,
        IReadOnlyList<Exam.Domain.Delivery.Attempt> attempts,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var inProgress = (await _sessions.ListAsync(ExamSessionStatus.InProgress, null, cancellationToken))
            .Where(s => s.OpenAt <= now && now <= s.CloseAt && s.ClosedAt is null)
            .ToList();

        if (inProgress.Count == 0)
        {
            return null;
        }

        var rosterSessionIds = (await _participants.ListSessionIdsByUserAsync(userId, cancellationToken)).ToHashSet();

        var visible = inProgress
            .Where(s =>
                s.ParticipantMode == ParticipantMode.OpenToAll
                || s.ParticipantUserIds.Contains(userId)
                || rosterSessionIds.Contains(s.Id))
            .OrderBy(s => s.CloseAt)
            .ThenBy(s => s.Id)
            .ToList();

        var session = visible.FirstOrDefault();
        if (session is null)
        {
            return null;
        }

        var started = attempts.Any(a => a.ExamSessionId == session.Id);

        return new OngoingExamDto(
            session.Id,
            session.Name,
            session.OpenAt,
            session.CloseAt,
            session.Note,
            started);
    }

    /// <summary>待完成练习与推荐练习。</summary>
    private async Task<(int PendingCount, IReadOnlyList<RecommendedPracticeDto> Recommended)> BuildPracticesAsync(
        long userId,
        IReadOnlyList<Exam.Domain.Delivery.Attempt> submitted,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var visible = await _practiceVisibility.ListVisibleAsync(userId, now, cancellationToken);
        if (visible.Count == 0)
        {
            return (0, []);
        }

        var completedIds = submitted
            .Where(a => a.PracticeAssignmentId != null)
            .Select(a => a.PracticeAssignmentId!.Value)
            .ToHashSet();

        var pending = visible.Where(p => !completedIds.Contains(p.Id)).ToList();
        if (pending.Count == 0)
        {
            return (0, []);
        }

        var papers = await _papers.GetByIdsAsync(pending.Select(p => p.PaperId).Distinct().ToList(), cancellationToken);
        var paperById = papers.ToDictionary(p => p.Id);

        var tagIds = papers.SelectMany(p => p.TagIds).Distinct().ToList();
        var tags = tagIds.Count > 0 ? await _tags.GetByIdsAsync(tagIds, cancellationToken) : [];
        var tagNameById = tags.ToDictionary(t => t.Id, t => t.Name);

        var recommended = pending
            .Take(RecommendedPracticeCount)
            .Select(p =>
            {
                var paper = paperById.GetValueOrDefault(p.PaperId);
                var tagNames = paper is null
                    ? []
                    : paper.TagIds.Select(id => tagNameById.GetValueOrDefault(id, string.Empty))
                        .Where(name => name.Length > 0)
                        .ToList();

                return new RecommendedPracticeDto(p.Id, p.Title, tagNames);
            })
            .ToList();

        return (pending.Count, recommended);
    }

    /// <summary>待清理的错题数与错题分布。</summary>
    private async Task<(int PendingCount, IReadOnlyList<MistakeDistributionDto> Distribution)> BuildMistakesAsync(
        long userId,
        CancellationToken cancellationToken)
    {
        var criteria = new MistakeSearchCriteria { UserId = userId, IncludeResolved = false };

        var pendingCount = await _mistakes.CountAsync(criteria, cancellationToken);
        var mistakes = await _mistakes.SearchAsync(criteria, 0, MistakeScanLimit, cancellationToken);
        if (mistakes.Count == 0)
        {
            return (pendingCount, []);
        }

        var questionIds = mistakes.Select(m => m.QuestionId).Distinct().ToList();
        var questions = await _questions.GetByIdsAsync(questionIds, cancellationToken);
        var questionById = questions.ToDictionary(q => q.Id);

        var tagIds = questions.SelectMany(q => q.TagIds).Distinct().ToList();
        var tags = tagIds.Count > 0 ? await _tags.GetByIdsAsync(tagIds, cancellationToken) : [];
        var tagById = tags.ToDictionary(t => t.Id);

        var groups = new Dictionary<string, (string Name, string Group, int Count)>();

        foreach (var mistake in mistakes)
        {
            if (!questionById.TryGetValue(mistake.QuestionId, out var question))
            {
                continue;
            }

            // 分组：优先知识点标签，其次领域标签，都没有算「未归类」。
            var tag = question.TagIds
                    .Select(id => tagById.GetValueOrDefault(id))
                    .FirstOrDefault(t => t is not null && t.Group == TagGroup.KnowledgePoint)
                ?? question.TagIds
                    .Select(id => tagById.GetValueOrDefault(id))
                    .FirstOrDefault(t => t is not null && t.Group == TagGroup.Domain);

            var key = tag?.Id.ToString() ?? "unknown";
            var entry = groups.GetValueOrDefault(key);

            groups[key] = (
                tag?.Name ?? "未归类",
                tag?.Group.Label() ?? "领域",
                entry.Count + 1);
        }

        var distribution = groups.Values
            .OrderByDescending(g => g.Count)
            .ThenBy(g => g.Name, StringComparer.Ordinal)
            .Select(g => new MistakeDistributionDto(g.Name, g.Group, g.Count))
            .ToList();

        return (pendingCount, distribution);
    }

    private static decimal Round(decimal value, int digits) => Math.Round(value, digits, MidpointRounding.AwayFromZero);
}

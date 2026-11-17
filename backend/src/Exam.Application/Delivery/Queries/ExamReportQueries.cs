using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Delivery.Contracts;
using Exam.Application.Grading.Services;
using Exam.Application.Delivery.Services;
using Exam.Application.Learning.Services;
using Exam.Domain.Authoring;
using Exam.Domain.Catalog;
using Exam.Domain.Delivery;
using Exam.Domain.Grading;
using Exam.Domain.Identity;
using MediatR;

namespace Exam.Application.Delivery.Queries;

/// <summary>
/// 取回成绩报告。
/// <para>
/// 正确答案与解析受答案公布策略约束：没到公布时机，答案与解析一律不给。
/// </para>
/// </summary>
public sealed record GetAttemptReportQuery(long AttemptId)
    : IAppQuery<ExamReportDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AttemptReadOwn];
}

public sealed class GetAttemptReportHandler : IRequestHandler<GetAttemptReportQuery, ExamReportDto>
{
    private readonly IAttemptRepository _attempts;
    private readonly IExamSessionRepository _sessions;
    private readonly IPracticeAssignmentRepository _practiceAssignments;
    private readonly IAnswerRepository _answers;
    private readonly IScoreResultRepository _scoreResults;
    private readonly AttemptPaperResolver _resolver;
    private readonly GradeVisibilityResolver _visibility;
    private readonly PracticeRulesResolver _practiceRules;
    private readonly ExamAccessScope _scope;
    private readonly ICurrentUser _currentUser;

    public GetAttemptReportHandler(
        IAttemptRepository attempts,
        IExamSessionRepository sessions,
        IPracticeAssignmentRepository practiceAssignments,
        IAnswerRepository answers,
        IScoreResultRepository scoreResults,
        AttemptPaperResolver resolver,
        GradeVisibilityResolver visibility,
        PracticeRulesResolver practiceRules,
        ICurrentUser currentUser,
        ExamAccessScope scope)
    {
        _scope = scope;
        _attempts = attempts;
        _sessions = sessions;
        _practiceAssignments = practiceAssignments;
        _answers = answers;
        _scoreResults = scoreResults;
        _resolver = resolver;
        _visibility = visibility;
        _practiceRules = practiceRules;
        _currentUser = currentUser;
    }

    public async Task<ExamReportDto> Handle(
        GetAttemptReportQuery request,
        CancellationToken cancellationToken)
    {
        var attempt = await _attempts.GetByIdAsync(request.AttemptId, cancellationToken)
            ?? throw new NotFoundException("作答会话不存在。");

        var userId = _currentUser.UserId;
        await _scope.EnsureAttemptVisibleAsync(attempt, cancellationToken);

        // 考试走场次快照，练习走练习开放单挂的试卷——练习的报告同样要逐题解析。
        var paper = await _resolver.ResolveAsync(attempt, cancellationToken);
        var session = paper.Session;
        var snapshot = paper.Snapshot;

        var results = await _scoreResults.ListByAttemptAsync(attempt.Id, cancellationToken);
        var answers = await _answers.ListByAttemptAsync(attempt.Id, cancellationToken);

        var pending = AttemptScoreSummaryFactory.IsSubjectivePending(results);
        var visibility = await _visibility.ResolveAsync(
            attempt.ExamSessionId,
            attempt.Id,
            pending,
            cancellationToken);

        var summary = AttemptScoreSummaryFactory.Build(results, visibility);
        var scoresPublished = visibility == GradeVisibilities.Published;

        // 答案公布：策略说了算。没到公布时机，答案与解析一律不给。
        var policy = snapshot?.AnswerPolicy ?? AnswerPolicy.AfterClose;
        var reveal = session is not null
            ? AnswerRevealPolicy.ShouldReveal(policy, session.Status, attempt.IsSubmitted)
            : await ShouldRevealPracticeAsync(attempt, cancellationToken);

        var answerByQuestion = answers.ToDictionary(a => a.QuestionId);
        var resultByQuestion = results.ToDictionary(r => r.QuestionId);

        var details = new List<ExamReportDetailDto>();

        if (snapshot is not null)
        {
            foreach (var item in snapshot.Items.OrderBy(i => i.SortOrder))
            {
                var type = QuestionTypes.FromStorage(item.QuestionType) ?? QuestionType.Single;
                var result = resultByQuestion.GetValueOrDefault(item.QuestionId);
                var answer = answerByQuestion.GetValueOrDefault(item.QuestionId);

                // 成绩没发布：主观题的分先扣住（客观题的分照旧给）。
                var scoreVisible = result is not null
                    && (scoresPublished || result.Method == ScoringMethod.AutoScored);

                details.Add(new ExamReportDetailDto(
                    item.QuestionId,
                    answer?.PaperItemId ?? result?.PaperItemId ?? 0,
                    item.QuestionCode,
                    item.QuestionType,
                    type.Label(),
                    item.Stem,
                    answer?.Payload,
                    reveal ? item.CorrectKeys : [],
                    reveal ? item.ReferenceAnswer : null,
                    reveal ? item.Analysis : null,
                    scoreVisible ? result!.Score.Value : null,
                    item.Score.Value,
                    reveal));
            }
        }

        return new ExamReportDto(
            attempt.Id,
            attempt.AttemptNo,
            session?.Name ?? paper.PracticeAssignment?.Title,
            attempt.SubmittedAt,
            summary.ObjectiveScore,
            summary.ObjectiveMax,
            scoresPublished ? summary.TotalScore - summary.ObjectiveScore : null,
            summary.TotalMax - summary.ObjectiveMax,
            summary.TotalScore,
            summary.TotalMax,
            summary.GradeVisibility,
            reveal,
            policy.ToStorage(),
            details);
    }

    /// <summary>
    /// 练习报告是否公布答案：练习没有场次，按练习的反馈时机判定。
    /// 交卷后一律可看；未交卷只有「即时反馈」的练习可以边做边看。
    /// </summary>
    private async Task<bool> ShouldRevealPracticeAsync(
        Attempt attempt,
        CancellationToken cancellationToken)
    {
        if (attempt.IsSubmitted)
        {
            return true;
        }

        if (attempt.PracticeAssignmentId is not { } assignmentId)
        {
            return false;
        }

        var rules = await _practiceRules.ResolveAsync(assignmentId, cancellationToken);
        return string.Equals(rules.FeedbackTiming, "immediate", StringComparison.OrdinalIgnoreCase);
    }
}

/// <summary>我的成绩列表。</summary>
public sealed record GetMyResultsQuery : IAppQuery<MyResultListResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AttemptReadOwn];
}

public sealed class GetMyResultsHandler : IRequestHandler<GetMyResultsQuery, MyResultListResponse>
{
    private readonly IAttemptRepository _attempts;
    private readonly IExamSessionRepository _sessions;
    private readonly IPracticeAssignmentRepository _practiceAssignments;
    private readonly IScoreResultRepository _scoreResults;
    private readonly IGradePublicationRepository _publications;
    private readonly GradeVisibilityResolver _visibility;
    private readonly ICurrentUser _currentUser;

    public GetMyResultsHandler(
        IAttemptRepository attempts,
        IExamSessionRepository sessions,
        IPracticeAssignmentRepository practiceAssignments,
        IScoreResultRepository scoreResults,
        IGradePublicationRepository publications,
        GradeVisibilityResolver visibility,
        ICurrentUser currentUser)
    {
        _attempts = attempts;
        _sessions = sessions;
        _practiceAssignments = practiceAssignments;
        _scoreResults = scoreResults;
        _publications = publications;
        _visibility = visibility;
        _currentUser = currentUser;
    }

    public async Task<MyResultListResponse> Handle(
        GetMyResultsQuery request,
        CancellationToken cancellationToken)
    {
        var userId = _currentUser.UserId
            ?? throw new ForbiddenException("请先登录。");

        var attempts = (await _attempts.ListByUserAsync(userId, cancellationToken))
            // 强制交卷与超时自动交卷的成绩也要能被学生看到。
            .Where(a => a.IsSubmitted)
            .OrderByDescending(a => a.SubmittedAt)
            .ToList();

        if (attempts.Count == 0)
        {
            return new MyResultListResponse([], 0);
        }

        var results = await _scoreResults.ListByAttemptsAsync(attempts.Select(a => a.Id).ToList(), cancellationToken);
        var resultsByAttempt = results
            .GroupBy(r => r.AttemptId)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<ScoreResult>)g.ToList());

        // 发布记录按场次取一次就够，别一份一份去查。
        var sessionIds = attempts
            .Where(a => a.ExamSessionId is not null)
            .Select(a => a.ExamSessionId!.Value)
            .Distinct()
            .ToList();

        var publicationsBySession = new Dictionary<long, IReadOnlyList<GradePublication>>();
        foreach (var sessionId in sessionIds)
        {
            publicationsBySession[sessionId] = await _publications.ListBySessionAsync(sessionId, cancellationToken);
        }

        var sessionNames = new Dictionary<long, string>();
        foreach (var sessionId in sessionIds)
        {
            var session = await _sessions.GetByIdAsync(sessionId, cancellationToken);
            if (session is not null)
            {
                sessionNames[sessionId] = session.Name;
            }
        }

        // 练习的成绩也要有名字：练习开放单的标题。
        var practiceIds = attempts
            .Where(a => a.PracticeAssignmentId != null)
            .Select(a => a.PracticeAssignmentId!.Value)
            .Distinct()
            .ToList();

        var practiceNames = new Dictionary<long, string>();
        if (practiceIds.Count > 0)
        {
            var assignments = await _practiceAssignments.GetByIdsAsync(practiceIds, cancellationToken);
            foreach (var assignment in assignments)
            {
                practiceNames[assignment.Id] = assignment.Title;
            }
        }

        var items = new List<MyResultDto>();

        foreach (var attempt in attempts)
        {
            var attemptResults = resultsByAttempt.TryGetValue(attempt.Id, out var list) ? list : [];
            var pending = AttemptScoreSummaryFactory.IsSubjectivePending(attemptResults);

            GradePublication? publication = null;
            if (attempt.ExamSessionId is { } sid
                && publicationsBySession.TryGetValue(sid, out var sessionPublications))
            {
                publication = sessionPublications
                    .Where(p => p.Covers(attempt.Id))
                    .OrderByDescending(p => p.PublishedAt)
                    .ThenByDescending(p => p.Id)
                    .FirstOrDefault();
            }

            var visibility = GradeVisibilityResolver.Resolve(publication, pending);
            var summary = AttemptScoreSummaryFactory.Build(attemptResults, visibility);

            items.Add(new MyResultDto(
                attempt.Id,
                attempt.ExamSessionId is { } sessionId
                    ? sessionNames.GetValueOrDefault(sessionId)
                    : attempt.PracticeAssignmentId is { } assignmentId
                        ? practiceNames.GetValueOrDefault(assignmentId)
                        : null,
                attempt.AttemptNo,
                attempt.SubmittedAt,
                summary.TotalScore,
                summary.TotalMax,
                summary.SubjectivePending,
                summary.GradeVisibility));
        }

        return new MyResultListResponse(items, items.Count);
    }
}

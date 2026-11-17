using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Delivery.Contracts;
using Exam.Application.Delivery.Services;
using Exam.Application.Grading.Contracts;
using Exam.Domain.Delivery;
using Exam.Domain.Grading;
using Exam.Domain.Identity;
using MediatR;

namespace Exam.Application.Grading.Queries;

/// <summary>取回一场考试的全部成绩（教师视角）。</summary>
public sealed record GetExamSessionGradesQuery(long ExamSessionId)
    : IAppQuery<ExamSessionGradeListResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AnalyticsRead];
}

public sealed class GetExamSessionGradesHandler
    : IRequestHandler<GetExamSessionGradesQuery, ExamSessionGradeListResponse>
{
    private readonly IExamSessionRepository _sessions;
    private readonly IAttemptRepository _attempts;
    private readonly IScoreResultRepository _scoreResults;
    private readonly IGradePublicationRepository _publications;
    private readonly IUserRepository _users;
    private readonly ICurrentUser _currentUser;
    private readonly ExamAccessScope _scope;

    public GetExamSessionGradesHandler(
        IExamSessionRepository sessions,
        IAttemptRepository attempts,
        IScoreResultRepository scoreResults,
        IGradePublicationRepository publications,
        IUserRepository users,
        ICurrentUser currentUser,
        ExamAccessScope scope)
    {
        _sessions = sessions;
        _attempts = attempts;
        _scoreResults = scoreResults;
        _publications = publications;
        _users = users;
        _currentUser = currentUser;
        _scope = scope;
    }

    public async Task<ExamSessionGradeListResponse> Handle(
        GetExamSessionGradesQuery request,
        CancellationToken cancellationToken)
    {
        var session = await _sessions.GetByIdAsync(request.ExamSessionId, cancellationToken)
            ?? throw new NotFoundException("考试场次不存在。");

        // 成绩只对自己负责的场次开放。
        await _scope.EnsureSessionVisibleAsync(session.Id, cancellationToken);

        var attempts = (await _attempts.ListBySessionAsync(session.Id, cancellationToken))
            // 强制交卷与超时自动交卷同样要出现在成绩里：
            // 只认「主动交卷」的话，被强制交卷的考生会凭空消失。
            .Where(a => a.IsSubmitted)
            .OrderBy(a => a.UserId)
            .ThenBy(a => a.AttemptNo)
            .ToList();

        if (attempts.Count == 0)
        {
            return new ExamSessionGradeListResponse(session.Id, session.Name, [], 0, 0);
        }

        var attemptIds = attempts.Select(a => a.Id).ToList();
        var results = await _scoreResults.ListByAttemptsAsync(attemptIds, cancellationToken);
        var resultsByAttempt = results
            .GroupBy(r => r.AttemptId)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<ScoreResult>)g.ToList());

        var publications = await _publications.ListBySessionAsync(session.Id, cancellationToken);

        var users = await _users.GetByIdsAsync(attempts.Select(a => a.UserId).Distinct().ToList(), cancellationToken);
        var userById = users.ToDictionary(u => u.Id);

        var items = new List<ExamSessionGradeDto>();
        var publishedCount = 0;

        foreach (var attempt in attempts)
        {
            var attemptResults = resultsByAttempt.TryGetValue(attempt.Id, out var list)
                ? list
                : [];

            var summary = AttemptScoreSummaryFactory.Build(attemptResults, GradeVisibilities.Published);
            var publication = LatestCovering(publications, attempt.Id);

            if (publication is not null)
            {
                publishedCount++;
            }

            var visibility = publication is null
                ? (summary.SubjectivePending ? GradeVisibilities.PendingReview : GradeVisibilities.ObjectiveOnly)
                : publication.Scope == GradePublicationScope.All
                    ? GradeVisibilities.Published
                    : GradeVisibilities.ObjectiveOnly;

            var student = userById.GetValueOrDefault(attempt.UserId);

            items.Add(new ExamSessionGradeDto(
                attempt.Id,
                attempt.AttemptNo,
                attempt.UserId,
                student?.Username ?? string.Empty,
                student?.DisplayName ?? string.Empty,
                summary.ObjectiveScore,
                summary.ObjectiveMax,
                summary.TotalScore,
                summary.TotalMax,
                summary.SubjectivePending,
                visibility,
                publication is not null,
                attempt.SubmittedAt));
        }

        return new ExamSessionGradeListResponse(session.Id, session.Name, items, items.Count, publishedCount);
    }

    /// <summary>取回覆盖某份作答的最新一条发布记录。</summary>
    private static GradePublication? LatestCovering(
        IReadOnlyList<GradePublication> publications,
        long attemptId) =>
        publications
            .Where(p => p.Covers(attemptId))
            .OrderByDescending(p => p.PublishedAt)
            .ThenByDescending(p => p.Id)
            .FirstOrDefault();
}

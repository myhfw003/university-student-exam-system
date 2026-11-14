using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Grading.Contracts;
using Exam.Domain.Identity;
using MediatR;

namespace Exam.Application.Grading.Queries;

/// <summary>
/// 取回一次作答的改分流水。
/// <para>
/// 学生端可见：改过几次分、改了多少、谁改的，白纸黑字摆在那里。
/// </para>
/// </summary>
public sealed record GetAttemptGradeRevisionsQuery(long AttemptId)
    : IAppQuery<GradeRevisionListResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AttemptReadOwn];
}

public sealed class GetAttemptGradeRevisionsHandler
    : IRequestHandler<GetAttemptGradeRevisionsQuery, GradeRevisionListResponse>
{
    private readonly IAttemptRepository _attempts;
    private readonly IScoreResultRepository _scoreResults;
    private readonly IGradeRevisionRepository _revisions;
    private readonly ICurrentUser _currentUser;

    public GetAttemptGradeRevisionsHandler(
        IAttemptRepository attempts,
        IScoreResultRepository scoreResults,
        IGradeRevisionRepository revisions,
        ICurrentUser currentUser)
    {
        _attempts = attempts;
        _scoreResults = scoreResults;
        _revisions = revisions;
        _currentUser = currentUser;
    }

    public async Task<GradeRevisionListResponse> Handle(
        GetAttemptGradeRevisionsQuery request,
        CancellationToken cancellationToken)
    {
        var attempt = await _attempts.GetByIdAsync(request.AttemptId, cancellationToken)
            ?? throw new NotFoundException("作答会话不存在。");

        var userId = _currentUser.UserId;
        if (userId != attempt.UserId && !_currentUser.HasPermission(PermissionCatalog.AttemptReadAll))
        {
            throw new ForbiddenException("只能查看自己的改分记录。");
        }

        var results = await _scoreResults.ListByAttemptAsync(attempt.Id, cancellationToken);
        var questionByResult = results.ToDictionary(r => r.Id, r => r.QuestionId);

        var revisions = await _revisions.ListByAttemptAsync(attempt.Id, cancellationToken);

        var items = revisions
            .Select(r => new GradeRevisionDto(
                r.Id,
                questionByResult.GetValueOrDefault(r.ScoreResultId),
                r.ScoreResultId,
                r.PreviousScore,
                r.NewScore,
                r.Comment,
                r.OperatorId,
                r.OccurredAt))
            .ToList();

        return new GradeRevisionListResponse(attempt.Id, items, items.Count);
    }
}

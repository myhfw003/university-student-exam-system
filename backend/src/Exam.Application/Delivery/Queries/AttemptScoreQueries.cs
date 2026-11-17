using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Delivery.Services;
using Exam.Application.Delivery.Contracts;
using Exam.Domain.Identity;
using MediatR;

namespace Exam.Application.Delivery.Queries;

/// <summary>取回一次作答的成绩（含逐题明细）。</summary>
public sealed record GetAttemptScoresQuery(long AttemptId)
    : IAppQuery<AttemptScoreSummaryDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AttemptReadOwn];
}

public sealed class GetAttemptScoresHandler : IRequestHandler<GetAttemptScoresQuery, AttemptScoreSummaryDto>
{
    private readonly IAttemptRepository _attempts;
    private readonly IScoreResultRepository _scoreResults;
    private readonly Exam.Application.Grading.Services.GradeVisibilityResolver _visibility;
    private readonly ExamAccessScope _scope;
    private readonly ICurrentUser _currentUser;

    public GetAttemptScoresHandler(
        IAttemptRepository attempts,
        IScoreResultRepository scoreResults,
        Exam.Application.Grading.Services.GradeVisibilityResolver visibility,
        ICurrentUser currentUser,
        ExamAccessScope scope)
    {
        _scope = scope;
        _attempts = attempts;
        _scoreResults = scoreResults;
        _visibility = visibility;
        _currentUser = currentUser;
    }

    public async Task<AttemptScoreSummaryDto> Handle(
        GetAttemptScoresQuery request,
        CancellationToken cancellationToken)
    {
        var attempt = await _attempts.GetByIdAsync(request.AttemptId, cancellationToken)
            ?? throw new NotFoundException("作答会话不存在。");

        await _scope.EnsureAttemptVisibleAsync(attempt, cancellationToken);

        var results = await _scoreResults.ListByAttemptAsync(attempt.Id, cancellationToken);

        // 成绩没发布之前，主观题的部分不露出去。
        var pending = AttemptScoreSummaryFactory.IsSubjectivePending(results);
        var visibility = await _visibility.ResolveAsync(
            attempt.ExamSessionId,
            attempt.Id,
            pending,
            cancellationToken);

        return AttemptScoreSummaryFactory.Build(results, visibility);
    }
}

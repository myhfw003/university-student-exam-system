using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
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
    private readonly ICurrentUser _currentUser;

    public GetAttemptScoresHandler(
        IAttemptRepository attempts,
        IScoreResultRepository scoreResults,
        ICurrentUser currentUser)
    {
        _attempts = attempts;
        _scoreResults = scoreResults;
        _currentUser = currentUser;
    }

    public async Task<AttemptScoreSummaryDto> Handle(
        GetAttemptScoresQuery request,
        CancellationToken cancellationToken)
    {
        var attempt = await _attempts.GetByIdAsync(request.AttemptId, cancellationToken)
            ?? throw new NotFoundException("作答会话不存在。");

        var userId = _currentUser.UserId;
        if (userId != attempt.UserId && !_currentUser.HasPermission(PermissionCatalog.AttemptReadAll))
        {
            throw new ForbiddenException("只能查看自己的成绩。");
        }

        var results = await _scoreResults.ListByAttemptAsync(attempt.Id, cancellationToken);
        return AttemptScoreSummaryFactory.Build(results);
    }
}

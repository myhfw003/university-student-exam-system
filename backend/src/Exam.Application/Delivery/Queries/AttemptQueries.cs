using Exam.Application.Authoring.Contracts;
using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Delivery.Contracts;
using Exam.Application.Delivery.Services;
using Exam.Domain.Delivery;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using MediatR;

namespace Exam.Application.Delivery.Queries;

/// <summary>恢复作答状态。</summary>
public sealed record GetAttemptQuery(long Id) : IAppQuery<AttemptResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AttemptReadOwn];
}

public sealed class GetAttemptHandler : IRequestHandler<GetAttemptQuery, AttemptResponse>
{
    private readonly IAttemptRepository _attempts;
    private readonly IAnswerRepository _answers;
    private readonly IExamSessionRepository _sessions;
    private readonly AttemptPaperSurfaceBuilder _surfaceBuilder;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public GetAttemptHandler(
        IAttemptRepository attempts,
        IAnswerRepository answers,
        IExamSessionRepository sessions,
        AttemptPaperSurfaceBuilder surfaceBuilder,
        IClock clock,
        ICurrentUser currentUser)
    {
        _attempts = attempts;
        _answers = answers;
        _sessions = sessions;
        _surfaceBuilder = surfaceBuilder;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<AttemptResponse> Handle(GetAttemptQuery request, CancellationToken cancellationToken)
    {
        var attempt = await _attempts.GetByIdAsync(request.Id, cancellationToken)
            ?? throw new NotFoundException("作答会话不存在。");

        var userId = _currentUser.UserId;
        if (userId != attempt.UserId && !_currentUser.HasPermission(PermissionCatalog.AttemptReadAll))
        {
            throw new ForbiddenException("只能查看自己的作答。");
        }

        var session = await _sessions.GetByIdAsync(attempt.ExamSessionId!.Value, cancellationToken)
            ?? throw new NotFoundException("考试场次不存在。");

        var surface = await _surfaceBuilder.BuildAsync(session, attempt.UserId, cancellationToken);
        var answers = await _answers.ListByAttemptAsync(attempt.Id, cancellationToken);
        var now = _clock.UtcNow;

        return AttemptResponseFactory.Build(attempt, session, surface, answers, now);
    }
}

/// <summary>我的会话列表。</summary>
public sealed record ListAttemptsQuery() : IAppQuery<AttemptListResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AttemptReadOwn];
}

public sealed class ListAttemptsHandler : IRequestHandler<ListAttemptsQuery, AttemptListResponse>
{
    private readonly IAttemptRepository _attempts;
    private readonly IExamSessionRepository _sessions;
    private readonly ICurrentUser _currentUser;

    public ListAttemptsHandler(
        IAttemptRepository attempts,
        IExamSessionRepository sessions,
        ICurrentUser currentUser)
    {
        _attempts = attempts;
        _sessions = sessions;
        _currentUser = currentUser;
    }

    public async Task<AttemptListResponse> Handle(ListAttemptsQuery request, CancellationToken cancellationToken)
    {
        var userId = _currentUser.UserId
            ?? throw new ForbiddenException("请先登录。");

        var attempts = await _attempts.ListByUserAsync(userId, cancellationToken);
        var sessions = await _sessions.ListAsync(null, null, cancellationToken);
        var sessionNames = sessions.ToDictionary(s => s.Id, s => s.Name);

        var items = attempts
            .Select(a => new AttemptSummaryDto(
                a.Id,
                a.TargetType.ToStorage(),
                a.ExamSessionId is null ? null : sessionNames.GetValueOrDefault(a.ExamSessionId.Value),
                a.Status.ToStorage(),
                a.Status.Label(),
                a.AttemptNo,
                a.StartedAt,
                a.SubmittedAt,
                a.DeadlineAt))
            .ToList();

        return new AttemptListResponse(items, items.Count);
    }
}

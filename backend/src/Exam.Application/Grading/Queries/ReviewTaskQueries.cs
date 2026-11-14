using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Grading.Contracts;
using Exam.Domain.Catalog;
using Exam.Domain.Grading;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Exceptions;
using MediatR;

namespace Exam.Application.Grading.Queries;

/// <summary>阅卷任务队列。</summary>
public sealed record ListReviewTasksQuery(
    string? Status,
    long? ExamSessionId,
    bool Mine,
    int Page,
    int Size) : IAppQuery<ReviewTaskListResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ReviewGrade];
}

public sealed class ListReviewTasksHandler : IRequestHandler<ListReviewTasksQuery, ReviewTaskListResponse>
{
    private readonly IReviewTaskRepository _tasks;
    private readonly IAttemptRepository _attempts;
    private readonly IExamSessionRepository _sessions;
    private readonly IQuestionRepository _questions;
    private readonly ICurrentUser _currentUser;

    public ListReviewTasksHandler(
        IReviewTaskRepository tasks,
        IAttemptRepository attempts,
        IExamSessionRepository sessions,
        IQuestionRepository questions,
        ICurrentUser currentUser)
    {
        _tasks = tasks;
        _attempts = attempts;
        _sessions = sessions;
        _questions = questions;
        _currentUser = currentUser;
    }

    public async Task<ReviewTaskListResponse> Handle(
        ListReviewTasksQuery request,
        CancellationToken cancellationToken)
    {
        var page = Math.Max(1, request.Page);
        var size = Math.Clamp(request.Size, 1, 200);

        ReviewTaskStatus? status = null;
        if (!string.IsNullOrWhiteSpace(request.Status))
        {
            status = ReviewTaskStatuses.FromStorage(request.Status)
                ?? throw new BusinessRuleException("阅卷任务状态取值不合法。");
        }

        var assigneeId = request.Mine ? _currentUser.UserId : null;

        var total = await _tasks.CountAsync(status, request.ExamSessionId, assigneeId, cancellationToken);
        var tasks = await _tasks.SearchAsync(
            status,
            request.ExamSessionId,
            assigneeId,
            (page - 1) * size,
            size,
            cancellationToken);

        var attempts = await _attempts.GetByIdsAsync(tasks.Select(t => t.AttemptId).Distinct().ToList(), cancellationToken);
        var attemptById = attempts.ToDictionary(a => a.Id);

        var sessionIds = attempts
            .Select(a => a.ExamSessionId)
            .Where(id => id is not null)
            .Select(id => id!.Value)
            .Distinct()
            .ToList();
        var sessions = sessionIds.Count == 0
            ? []
            : await _sessions.GetByIdsAsync(sessionIds, cancellationToken);
        var sessionNames = sessions.ToDictionary(s => s.Id, s => s.Name);

        var questions = await _questions.GetByIdsAsync(tasks.Select(t => t.QuestionId).Distinct().ToList(), cancellationToken);
        var questionById = questions.ToDictionary(q => q.Id);

        var items = tasks.Select(task =>
        {
            var attempt = attemptById.GetValueOrDefault(task.AttemptId);
            var question = questionById.GetValueOrDefault(task.QuestionId);

            return new ReviewTaskDto(
                task.Id,
                task.AttemptId,
                attempt?.AttemptNo ?? 1,
                attempt?.ExamSessionId is { } sessionId
                    ? sessionNames.GetValueOrDefault(sessionId, string.Empty)
                    : string.Empty,
                task.ExamSessionId,
                task.QuestionId,
                question?.Code ?? string.Empty,
                question?.Type.ToStorage() ?? string.Empty,
                task.StepCode,
                task.AnswerText,
                task.SuggestedScore?.Value,
                task.MaxScore.Value,
                task.Status.ToStorage(),
                task.Status.Label(),
                task.AssigneeId,
                task.ReviewerId,
                task.FinalScore?.Value,
                task.Comment,
                task.CreatedAt,
                task.ReviewedAt);
        }).ToList();

        return new ReviewTaskListResponse(items, total, page, size);
    }
}

/// <summary>阅卷任务计数。</summary>
public sealed record GetReviewTaskCountQuery(long? ExamSessionId)
    : IAppQuery<ReviewTaskCountDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ReviewGrade];
}

public sealed class GetReviewTaskCountHandler : IRequestHandler<GetReviewTaskCountQuery, ReviewTaskCountDto>
{
    private readonly IReviewTaskRepository _tasks;
    private readonly ICurrentUser _currentUser;

    public GetReviewTaskCountHandler(IReviewTaskRepository tasks, ICurrentUser currentUser)
    {
        _tasks = tasks;
        _currentUser = currentUser;
    }

    public async Task<ReviewTaskCountDto> Handle(
        GetReviewTaskCountQuery request,
        CancellationToken cancellationToken)
    {
        var pending = await _tasks.CountAsync(ReviewTaskStatus.Pending, request.ExamSessionId, null, cancellationToken);
        var inReview = await _tasks.CountAsync(ReviewTaskStatus.InReview, request.ExamSessionId, null, cancellationToken);
        var reviewed = await _tasks.CountAsync(ReviewTaskStatus.Reviewed, request.ExamSessionId, null, cancellationToken);
        var mine = await _tasks.CountAsync(null, request.ExamSessionId, _currentUser.UserId, cancellationToken);

        return new ReviewTaskCountDto(pending, inReview, reviewed, mine);
    }
}

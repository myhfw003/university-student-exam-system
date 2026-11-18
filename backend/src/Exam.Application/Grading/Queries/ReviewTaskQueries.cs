using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Grading.Contracts;
using Exam.Application.Grading.Services;
using Exam.Domain.Authoring;
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
    long? QuestionId,
    long? AssigneeId,
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
    private readonly IUserRepository _users;
    private readonly ICurrentUser _currentUser;

    public ListReviewTasksHandler(
        IReviewTaskRepository tasks,
        IAttemptRepository attempts,
        IExamSessionRepository sessions,
        IQuestionRepository questions,
        IUserRepository users,
        ICurrentUser currentUser)
    {
        _tasks = tasks;
        _attempts = attempts;
        _sessions = sessions;
        _questions = questions;
        _users = users;
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

        // mine 是「指派给我的」的简写；显式传 assigneeId 时以显式值为准。
        var assigneeId = request.AssigneeId ?? (request.Mine ? _currentUser.UserId : null);

        var criteria = new ReviewTaskSearchCriteria
        {
            Status = status,
            ExamSessionId = request.ExamSessionId,
            QuestionId = request.QuestionId,
            AssigneeId = assigneeId,
        };

        var total = await _tasks.CountAsync(criteria, cancellationToken);
        var tasks = await _tasks.SearchAsync(
            criteria,
            (page - 1) * size,
            size,
            cancellationToken);

        var items = await ReviewTaskDtoMapper.MapAsync(
            tasks,
            _attempts,
            _sessions,
            _questions,
            _users,
            cancellationToken);

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
        ReviewTaskSearchCriteria Criteria(ReviewTaskStatus? status, long? assigneeId) => new()
        {
            Status = status,
            ExamSessionId = request.ExamSessionId,
            AssigneeId = assigneeId,
        };

        var pending = await _tasks.CountAsync(Criteria(ReviewTaskStatus.Pending, null), cancellationToken);
        var inReview = await _tasks.CountAsync(Criteria(ReviewTaskStatus.InReview, null), cancellationToken);
        var reviewed = await _tasks.CountAsync(Criteria(ReviewTaskStatus.Reviewed, null), cancellationToken);
        var mine = await _tasks.CountAsync(Criteria(null, _currentUser.UserId), cancellationToken);

        return new ReviewTaskCountDto(pending, inReview, reviewed, mine);
    }
}

/// <summary>
/// 阅卷卷宗详情：作答原文、参考答案、系统初判的要点命中。
/// <para>参考答案只来自已发布的快照——考的是哪份卷子，就按哪份卷子对。</para>
/// </summary>
public sealed record GetReviewTaskDetailQuery(long TaskId)
    : IAppQuery<ReviewTaskDetailDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ReviewGrade];
}

public sealed class GetReviewTaskDetailHandler : IRequestHandler<GetReviewTaskDetailQuery, ReviewTaskDetailDto>
{
    private readonly IReviewTaskRepository _tasks;
    private readonly IAttemptRepository _attempts;
    private readonly IExamSessionRepository _sessions;
    private readonly IQuestionRepository _questions;
    private readonly IScoreResultRepository _scoreResults;
    private readonly IPaperSnapshotRepository _snapshots;
    private readonly IUserRepository _users;

    public GetReviewTaskDetailHandler(
        IReviewTaskRepository tasks,
        IAttemptRepository attempts,
        IExamSessionRepository sessions,
        IQuestionRepository questions,
        IScoreResultRepository scoreResults,
        IPaperSnapshotRepository snapshots,
        IUserRepository users)
    {
        _tasks = tasks;
        _attempts = attempts;
        _sessions = sessions;
        _questions = questions;
        _scoreResults = scoreResults;
        _snapshots = snapshots;
        _users = users;
    }

    public async Task<ReviewTaskDetailDto> Handle(
        GetReviewTaskDetailQuery request,
        CancellationToken cancellationToken)
    {
        var task = await _tasks.GetByIdAsync(request.TaskId, cancellationToken)
            ?? throw new NotFoundException("阅卷任务不存在。");

        var attempt = await _attempts.GetByIdAsync(task.AttemptId, cancellationToken);

        var session = task.ExamSessionId is { } sessionId
            ? await _sessions.GetByIdAsync(sessionId, cancellationToken)
            : null;

        // 卷面内容取自快照：题目后来改了也不影响这场考试的对错。
        SnapshotItem? item = null;
        if (session?.SnapshotId is { } snapshotId)
        {
            var snapshot = await _snapshots.GetByIdAsync(snapshotId, cancellationToken);
            item = snapshot?.Items.FirstOrDefault(i => i.QuestionId == task.QuestionId);
        }

        var scoreResult = await _scoreResults.GetAsync(task.AttemptId, task.QuestionId, cancellationToken);
        var hitItems = scoreResult?.Detail.HitItems ?? [];
        var missedItems = scoreResult?.Detail.MissedItems ?? [];
        var notes = scoreResult?.Detail.Notes ?? [];

        var keypoints = (item?.Keypoints ?? [])
            .Select(k => new ReviewKeypointDto(k.Text, hitItems.Contains(k.Text)))
            .ToList();

        var steps = (item?.Steps ?? [])
            .Select(s => new ReviewStepDto(s.Code, s.Prompt, s.Score, hitItems.Contains(s.Code)))
            .ToList();

        string? studentUsername = null;
        string? studentDisplayName = null;
        if (attempt is not null)
        {
            var student = await _users.GetByIdAsync(attempt.UserId, cancellationToken);
            studentUsername = student?.Username;
            studentDisplayName = student?.DisplayName;
        }

        var dto = await ReviewTaskDtoMapper.MapAsync(
            [task],
            _attempts,
            _sessions,
            _questions,
            _users,
            cancellationToken);

        var question = item is null
            ? null
            : await _questions.GetByIdAsync(task.QuestionId, cancellationToken);

        return new ReviewTaskDetailDto(
            dto[0],
            item?.Stem ?? question?.Stem ?? string.Empty,
            item?.QuestionType ?? question?.Type.ToStorage() ?? string.Empty,
            (question?.Type.Label()) ?? string.Empty,
            item?.ReferenceAnswer,
            item?.Analysis,
            keypoints,
            steps,
            hitItems,
            missedItems,
            notes,
            studentUsername,
            studentDisplayName);
    }
}

/// <summary>
/// 队列中的上一份 / 下一份。
/// <para>
/// 连续阅卷用：按队列顺序找相邻任务，不用翻页。
/// </para>
/// </summary>
public sealed record GetReviewTaskNeighborsQuery(
    long TaskId,
    string? Status,
    long? ExamSessionId,
    long? QuestionId,
    long? AssigneeId,
    bool Mine) : IAppQuery<ReviewTaskNeighborsDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ReviewGrade];
}

public sealed class GetReviewTaskNeighborsHandler : IRequestHandler<GetReviewTaskNeighborsQuery, ReviewTaskNeighborsDto>
{
    private readonly IReviewTaskRepository _tasks;
    private readonly ICurrentUser _currentUser;

    public GetReviewTaskNeighborsHandler(IReviewTaskRepository tasks, ICurrentUser currentUser)
    {
        _tasks = tasks;
        _currentUser = currentUser;
    }

    public async Task<ReviewTaskNeighborsDto> Handle(
        GetReviewTaskNeighborsQuery request,
        CancellationToken cancellationToken)
    {
        ReviewTaskStatus? status = null;
        if (!string.IsNullOrWhiteSpace(request.Status))
        {
            status = ReviewTaskStatuses.FromStorage(request.Status)
                ?? throw new BusinessRuleException("阅卷任务状态取值不合法。");
        }

        var assigneeId = request.AssigneeId ?? (request.Mine ? _currentUser.UserId : null);

        var (previousId, nextId) = await _tasks.GetNeighborIdsAsync(
            request.TaskId,
            new ReviewTaskSearchCriteria
            {
                Status = status,
                ExamSessionId = request.ExamSessionId,
                QuestionId = request.QuestionId,
                AssigneeId = assigneeId,
            },
            cancellationToken);

        return new ReviewTaskNeighborsDto(previousId, nextId);
    }
}

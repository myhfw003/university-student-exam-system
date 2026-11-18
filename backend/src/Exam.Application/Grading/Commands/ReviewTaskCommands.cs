using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Grading.Contracts;
using Exam.Application.Grading.Services;
using Exam.Domain.Grading;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using FluentValidation;
using MediatR;

namespace Exam.Application.Grading.Commands;

/// <summary>
/// 领取阅卷任务。先到先得：任务被人领走后再领就是失败。
/// </summary>
public sealed record ClaimReviewTaskCommand(long TaskId)
    : IAppCommand<ReviewTaskDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ReviewGrade];
}

public sealed class ClaimReviewTaskCommandValidator : AbstractValidator<ClaimReviewTaskCommand>
{
    public ClaimReviewTaskCommandValidator()
    {
        RuleFor(x => x.TaskId).GreaterThan(0).WithMessage("阅卷任务 ID 不合法。");
    }
}

public sealed class ClaimReviewTaskHandler : IRequestHandler<ClaimReviewTaskCommand, ReviewTaskDto>
{
    private readonly IReviewTaskRepository _tasks;
    private readonly IAttemptRepository _attempts;
    private readonly IExamSessionRepository _sessions;
    private readonly IQuestionRepository _questions;
    private readonly IUserRepository _users;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public ClaimReviewTaskHandler(
        IReviewTaskRepository tasks,
        IAttemptRepository attempts,
        IExamSessionRepository sessions,
        IQuestionRepository questions,
        IUserRepository users,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _tasks = tasks;
        _attempts = attempts;
        _sessions = sessions;
        _questions = questions;
        _users = users;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<ReviewTaskDto> Handle(
        ClaimReviewTaskCommand request,
        CancellationToken cancellationToken)
    {
        var task = await _tasks.GetByIdAsync(request.TaskId, cancellationToken)
            ?? throw new NotFoundException("阅卷任务不存在。");

        var reviewerId = _currentUser.UserId
            ?? throw new ForbiddenException("请先登录。");

        // 先到先得由领域规则守住：任务不再待领取，或已指派给别人，都会失败。
        task.Claim(reviewerId, _clock.UtcNow);
        _tasks.Update(task);

        await _audit.RecordAsync(
            "review_task.claim",
            "review_task",
            task.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["attemptId"] = task.AttemptId,
                ["questionId"] = task.QuestionId,
                ["stepCode"] = task.StepCode,
                ["reviewerId"] = reviewerId,
            },
            cancellationToken);

        var dtos = await ReviewTaskDtoMapper.MapAsync(
            [task],
            _attempts,
            _sessions,
            _questions,
            _users,
            cancellationToken);

        return dtos[0];
    }
}

/// <summary>
/// 指派阅卷任务给指定阅卷人。
/// <para>指派只是「分给他」，任务仍在待领取队列里等人来领。</para>
/// </summary>
public sealed record AssignReviewTaskCommand(long TaskId, long AssigneeId)
    : IAppCommand<ReviewTaskDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ReviewGrade];
}

public sealed class AssignReviewTaskCommandValidator : AbstractValidator<AssignReviewTaskCommand>
{
    public AssignReviewTaskCommandValidator()
    {
        RuleFor(x => x.TaskId).GreaterThan(0).WithMessage("阅卷任务 ID 不合法。");
        RuleFor(x => x.AssigneeId).GreaterThan(0).WithMessage("阅卷人 ID 不合法。");
    }
}

public sealed class AssignReviewTaskHandler : IRequestHandler<AssignReviewTaskCommand, ReviewTaskDto>
{
    private readonly IReviewTaskRepository _tasks;
    private readonly IAttemptRepository _attempts;
    private readonly IExamSessionRepository _sessions;
    private readonly IQuestionRepository _questions;
    private readonly IUserRepository _users;
    private readonly IUserPermissionService _permissions;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public AssignReviewTaskHandler(
        IReviewTaskRepository tasks,
        IAttemptRepository attempts,
        IExamSessionRepository sessions,
        IQuestionRepository questions,
        IUserRepository users,
        IUserPermissionService permissions,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _tasks = tasks;
        _attempts = attempts;
        _sessions = sessions;
        _questions = questions;
        _users = users;
        _permissions = permissions;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<ReviewTaskDto> Handle(
        AssignReviewTaskCommand request,
        CancellationToken cancellationToken)
    {
        var task = await _tasks.GetByIdAsync(request.TaskId, cancellationToken)
            ?? throw new NotFoundException("阅卷任务不存在。");

        // 指派给没有阅卷权限的人等于把卷子扔掉，这种事当场拦下。
        var assignee = await _users.GetByIdAsync(request.AssigneeId, cancellationToken)
            ?? throw new NotFoundException("指派的阅卷人不存在。");

        if (assignee.Status != UserStatus.Active)
        {
            throw new BusinessRuleException("该用户已被禁用或锁定，不能指派阅卷任务。");
        }

        var codes = await _permissions.GetPermissionCodesAsync(assignee.Id, cancellationToken);
        if (!codes.Contains(PermissionCatalog.ReviewGrade))
        {
            throw new BusinessRuleException("该用户没有阅卷权限，不能指派阅卷任务。");
        }

        var operatorId = _currentUser.UserId
            ?? throw new ForbiddenException("请先登录。");

        task.Assign(assignee.Id, operatorId, _clock.UtcNow);
        _tasks.Update(task);

        await _audit.RecordAsync(
            "review_task.assign",
            "review_task",
            task.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["attemptId"] = task.AttemptId,
                ["questionId"] = task.QuestionId,
                ["assigneeId"] = assignee.Id,
                ["operatorId"] = operatorId,
            },
            cancellationToken);

        var dtos = await ReviewTaskDtoMapper.MapAsync(
            [task],
            _attempts,
            _sessions,
            _questions,
            _users,
            cancellationToken);

        return dtos[0];
    }
}

using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Delivery.Services;
using Exam.Application.Common.Markers;
using Exam.Application.Delivery.Contracts;
using Exam.Domain.Delivery;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using MediatR;

namespace Exam.Application.Delivery.Commands;

/// <summary>
/// 监考处置：警告 / 备注 / 强制交卷。
/// <para>强制交卷必须填原因，且对考生可见。</para>
/// </summary>
public sealed record CreateProctorActionCommand(
    long AttemptId,
    string ActionType,
    string? Message,
    string? Reason) : IAppCommand<ProctorActionDto>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.ProctorAct];
}

public sealed class CreateProctorActionHandler : IRequestHandler<CreateProctorActionCommand, ProctorActionDto>
{
    private readonly IAttemptRepository _attempts;
    private readonly IProctorActionRepository _actions;
    private readonly IExamSessionRepository _sessions;
    private readonly IExamNotifier _notifier;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;
    private readonly AttemptPaperResolver _resolver;
    private readonly AttemptFinalizationService _finalization;

    public CreateProctorActionHandler(
        IAttemptRepository attempts,
        IProctorActionRepository actions,
        IExamSessionRepository sessions,
        IExamNotifier notifier,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser,
        AttemptPaperResolver resolver,
        AttemptFinalizationService finalization)
    {
        _attempts = attempts;
        _actions = actions;
        _sessions = sessions;
        _notifier = notifier;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
        _resolver = resolver;
        _finalization = finalization;
    }

    public async Task<ProctorActionDto> Handle(
        CreateProctorActionCommand request,
        CancellationToken cancellationToken)
    {
        var attempt = await _attempts.GetByIdAsync(request.AttemptId, cancellationToken)
            ?? throw new NotFoundException("作答会话不存在。");

        var session = await _sessions.GetByIdAsync(attempt.ExamSessionId!.Value, cancellationToken)
            ?? throw new NotFoundException("考试场次不存在。");

        var actionType = ProctorActionTypes.FromStorage(request.ActionType?.Trim().ToLowerInvariant())
            ?? throw new BusinessRuleException("处置类型只能是 warn、note 或 force_submit。");

        var operatorId = _currentUser.UserId
            ?? throw new ForbiddenException("请先登录。");

        var now = _clock.UtcNow;

        // 强制交卷必须填原因——域内规则。
        var action = ProctorAction.Create(
            attempt.Id,
            session.Id,
            actionType,
            request.Message,
            request.Reason,
            operatorId,
            now);

        if (actionType == ProctorActionType.ForceSubmit)
        {
            var fromStatus = attempt.Status.ToStorage();

            // 已经交卷的作答不再重复判分：再落一条成绩会撞「一次作答一题一条成绩」
            // 的唯一约束，监考点一下强制交卷就会变成 500。
            if (!attempt.Submit(SubmitReason.ProctorForce, now))
            {
                throw new BusinessRuleException("该次作答已经交卷，无需再强制交卷。");
            }

            _attempts.Update(attempt);

            // 监考强制交卷同样要判分：考生的答卷不能因为是被强制结束的就没有成绩。
            var paper = await _resolver.ResolveAsync(attempt, cancellationToken);
            await _finalization.FinalizeAsync(
                attempt,
                paper,
                now,
                "attempt.force_submit_by_proctor",
                cancellationToken);
            await _notifier.NotifyStateChangedAsync(attempt.Id, fromStatus, attempt.Status.ToStorage(), cancellationToken);
        }

        if (actionType == ProctorActionType.Warn)
        {
            var message = string.IsNullOrWhiteSpace(request.Message)
                ? "监考教师提醒：请注意考试纪律。"
                : request.Message.Trim();

            await _notifier.WarnCandidateAsync(attempt.Id, message, cancellationToken);
        }

        await _actions.AddAsync(action, cancellationToken);

        await _audit.RecordAsync(
            "proctor_action.create",
            "proctor_action",
            action.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["attemptId"] = attempt.Id,
                ["examSessionId"] = session.Id,
                ["actionType"] = actionType.ToStorage(),
                ["reason"] = action.Reason,
            },
            cancellationToken);

        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return new ProctorActionDto(
            action.Id,
            action.AttemptId,
            action.ActionType.ToStorage(),
            action.Message,
            action.Reason,
            _currentUser.Username ?? string.Empty,
            action.CreatedAt);
    }
}

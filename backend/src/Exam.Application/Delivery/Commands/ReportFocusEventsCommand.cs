using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Delivery.Services;
using Exam.Application.Delivery.Contracts;
using Exam.Domain.Delivery;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Domain.SharedKernel.Exceptions;
using MediatR;

namespace Exam.Application.Delivery.Commands;

/// <summary>上报焦点事件（切屏、复制粘贴尝试等）。</summary>
public sealed record ReportFocusEventsCommand(long AttemptId, ReportFocusEventsInput Input)
    : IAppCommand<FocusEventsResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AttemptTake];
}

public sealed class ReportFocusEventsHandler : IRequestHandler<ReportFocusEventsCommand, FocusEventsResponse>
{
    /// <summary>单批上报上限。</summary>
    public const int MaxBatchSize = 100;

    private readonly IAttemptRepository _attempts;
    private readonly IFocusEventRepository _events;
    private readonly IExamSessionRepository _sessions;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;
    private readonly IExamMetrics _metrics;
    private readonly AttemptPaperResolver _resolver;
    private readonly AttemptFinalizationService _finalization;

    public ReportFocusEventsHandler(
        IAttemptRepository attempts,
        IFocusEventRepository events,
        IExamSessionRepository sessions,
        IUnitOfWork unitOfWork,
        IClock clock,
        ICurrentUser currentUser,
        IExamMetrics metrics,
        AttemptPaperResolver resolver,
        AttemptFinalizationService finalization)
    {
        _attempts = attempts;
        _events = events;
        _sessions = sessions;
        _unitOfWork = unitOfWork;
        _clock = clock;
        _currentUser = currentUser;
        _metrics = metrics;
        _resolver = resolver;
        _finalization = finalization;
    }

    public async Task<FocusEventsResponse> Handle(
        ReportFocusEventsCommand request,
        CancellationToken cancellationToken)
    {
        var attempt = await _attempts.GetByIdAsync(request.AttemptId, cancellationToken)
            ?? throw new NotFoundException("作答会话不存在。");

        var userId = _currentUser.UserId;
        if (userId != attempt.UserId && !_currentUser.HasPermission(PermissionCatalog.AttemptReadAll))
        {
            throw new ForbiddenException("只能上报自己的焦点事件。");
        }

        if (attempt.IsSubmitted)
        {
            throw new AttemptStateInvalidException("会话已交卷，不再接收焦点事件。");
        }

        // 练习没有场次：不限制切屏，也不会强制交卷。
        var session = attempt.ExamSessionId is { } sessionId
            ? await _sessions.GetByIdAsync(sessionId, cancellationToken)
            : null;

        var now = _clock.UtcNow;
        var limit = session?.Rules.MaxFocusLoss;

        var reported = new List<FocusEvent>();
        var focusLossCount = 0;

        foreach (var item in request.Input.Events ?? [])
        {
            var type = FocusEventTypes.FromStorage(item.Type?.Trim().ToLowerInvariant())
                ?? throw new BusinessRuleException($"未知的焦点事件类型「{item.Type}」。");

            reported.Add(FocusEvent.Create(attempt.Id, type, item.QuestionId, item.ClientAt, now));
            _metrics.RecordFocusEvent(type.ToStorage());

            if (type.IsFocusLoss())
            {
                focusLossCount++;
            }
        }

        // 流水只追加：每次切屏都留痕。
        await _events.AddRangeAsync(reported, cancellationToken);

        var limitReached = false;
        var forcedSubmit = false;
        var warned = false;

        for (var i = 0; i < focusLossCount; i++)
        {
            try
            {
                attempt.RecordFocusLoss(now, limit);
            }
            catch (FocusLimitExceededException)
            {
                limitReached = true;

                // 达到上限：按场次策略处置。
                if (session is not null
                    && string.Equals(session.Rules.OnMaxFocusLoss, "force_submit", StringComparison.OrdinalIgnoreCase))
                {
                    attempt.Submit(SubmitReason.ProctorForce, now);
                    forcedSubmit = true;

                    // 强制交卷也要判分：答案已经存下来了，不能让考生没有成绩。
                    var forcedPaper = await _resolver.ResolveAsync(attempt, cancellationToken);
                    await _finalization.FinalizeAsync(
                        attempt,
                        forcedPaper,
                        now,
                        "attempt.force_submit_by_focus",
                        cancellationToken);
                }
                else
                {
                    attempt.RecordWarning(now);
                    warned = true;
                }

                break;
            }
        }

        _attempts.Update(attempt);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return new FocusEventsResponse(
            attempt.FocusLossCount,
            limit,
            limitReached,
            forcedSubmit,
            warned,
            attempt.DisconnectCount,
            attempt.WarningCount,
            now);
    }
}

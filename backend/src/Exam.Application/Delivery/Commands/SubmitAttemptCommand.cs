using Exam.Application.Common.Attributes;
using Exam.Application.Common.Exceptions;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Markers;
using Exam.Application.Delivery.Contracts;
using Exam.Domain.Delivery;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using MediatR;

namespace Exam.Application.Delivery.Commands;

/// <summary>
/// 交卷。幂等：重复交卷返回同一个结果。
/// <para>交卷原因由服务端判定：客户端只能表达「主动交卷」。</para>
/// </summary>
public sealed record SubmitAttemptCommand(long AttemptId, string? Reason)
    : IAppCommand<SubmitAttemptResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AttemptTake];
}

public sealed class SubmitAttemptHandler : IRequestHandler<SubmitAttemptCommand, SubmitAttemptResponse>
{
    private readonly IAttemptRepository _attempts;
    private readonly IExamParticipantRepository _participants;
    private readonly IExamSessionRepository _sessions;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IAuditRecorder _audit;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public SubmitAttemptHandler(
        IAttemptRepository attempts,
        IExamParticipantRepository participants,
        IExamSessionRepository sessions,
        IUnitOfWork unitOfWork,
        IAuditRecorder audit,
        IClock clock,
        ICurrentUser currentUser)
    {
        _attempts = attempts;
        _participants = participants;
        _sessions = sessions;
        _unitOfWork = unitOfWork;
        _audit = audit;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<SubmitAttemptResponse> Handle(
        SubmitAttemptCommand request,
        CancellationToken cancellationToken)
    {
        var attempt = await _attempts.GetByIdAsync(request.AttemptId, cancellationToken)
            ?? throw new NotFoundException("作答会话不存在。");

        var userId = _currentUser.UserId;
        if (userId != attempt.UserId && !_currentUser.HasPermission(PermissionCatalog.AttemptReadAll))
        {
            throw new ForbiddenException("只能提交自己的作答。");
        }

        var session = await _sessions.GetByIdAsync(attempt.ExamSessionId!.Value, cancellationToken)
            ?? throw new NotFoundException("考试场次不存在。");

        var now = _clock.UtcNow;

        // 幂等：已交卷直接返回同一个结果，不再推进状态。
        if (attempt.IsSubmitted)
        {
            return BuildResponse(attempt);
        }

        // 交卷原因由服务端判定：超时就是 time_up，客户端说什么不算数。
        var reason = now > attempt.DeadlineAt ? SubmitReason.TimeUp : SubmitReason.Manual;

        attempt.Submit(reason, now);
        _attempts.Update(attempt);

        if (attempt.ExamSessionId is { } sessionId)
        {
            var participant = await _participants.GetAsync(sessionId, attempt.UserId, cancellationToken);
            if (participant is not null)
            {
                participant.MarkSubmitted(now);
                _participants.Update(participant);
            }
        }

        await _audit.RecordAsync(
            "attempt.submit",
            "attempt",
            attempt.Id.ToString(),
            new Dictionary<string, object?>
            {
                ["sessionId"] = session.Id,
                ["submitReason"] = reason.ToStorage(),
                ["durationSpentSeconds"] = attempt.DurationSpentSeconds,
            },
            cancellationToken);

        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return BuildResponse(attempt);
    }

    private static SubmitAttemptResponse BuildResponse(Attempt attempt) => new(
        attempt.Id,
        attempt.Status.ToStorage(),
        attempt.Status.Label(),
        attempt.SubmittedAt,
        attempt.SubmitReason?.ToStorage() ?? "manual",
        attempt.SubmitReason?.Label() ?? "主动交卷",
        null,
        null,
        false,
        null,
        null,
        "pending_review");
}

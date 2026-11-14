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
/// 心跳。考生端定时上报，服务端据此判断断连。
/// <para>断连次数超过场次规则上限时按断网超时代交。</para>
/// </summary>
public sealed record HeartbeatAttemptCommand(long AttemptId)
    : IAppCommand<HeartbeatResponse>, IAuthorizableRequest
{
    public IReadOnlyCollection<string> RequiredPermissions { get; init; } = [PermissionCatalog.AttemptTake];
}

public sealed class HeartbeatAttemptHandler : IRequestHandler<HeartbeatAttemptCommand, HeartbeatResponse>
{
    private readonly IAttemptRepository _attempts;
    private readonly IExamSessionRepository _sessions;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IClock _clock;
    private readonly ICurrentUser _currentUser;

    public HeartbeatAttemptHandler(
        IAttemptRepository attempts,
        IExamSessionRepository sessions,
        IUnitOfWork unitOfWork,
        IClock clock,
        ICurrentUser currentUser)
    {
        _attempts = attempts;
        _sessions = sessions;
        _unitOfWork = unitOfWork;
        _clock = clock;
        _currentUser = currentUser;
    }

    public async Task<HeartbeatResponse> Handle(
        HeartbeatAttemptCommand request,
        CancellationToken cancellationToken)
    {
        var attempt = await _attempts.GetByIdAsync(request.AttemptId, cancellationToken)
            ?? throw new NotFoundException("作答会话不存在。");

        var userId = _currentUser.UserId;
        if (userId != attempt.UserId && !_currentUser.HasPermission(PermissionCatalog.AttemptReadAll))
        {
            throw new ForbiddenException("只能上报自己的心跳。");
        }

        var session = await _sessions.GetByIdAsync(attempt.ExamSessionId!.Value, cancellationToken)
            ?? throw new NotFoundException("考试场次不存在。");

        var now = _clock.UtcNow;

        // 已交卷：心跳只是迟到，不再改变状态。
        if (attempt.IsSubmitted)
        {
            return BuildResponse(attempt, now);
        }

        // 断连判定：上一次心跳超时了就算断连一次（同一次断网只记一次）。
        attempt.TryMarkDisconnected(now, session.Rules.HeartbeatTimeoutSeconds);

        if (attempt.DisconnectCount > session.Rules.MaxDisconnect)
        {
            attempt.Submit(SubmitReason.NetworkTimeout, now);
        }
        else
        {
            attempt.RecordHeartbeat(now);
        }

        _attempts.Update(attempt);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return BuildResponse(attempt, now);
    }

    private static HeartbeatResponse BuildResponse(Attempt attempt, DateTimeOffset now) => new(
        now,
        attempt.RemainingSeconds(now),
        attempt.DisconnectCount,
        attempt.WarningCount,
        attempt.Status.ToStorage(),
        attempt.IsSubmitted,
        attempt.SubmitReason is null ? string.Empty : attempt.SubmitReason.Value.ToStorage());
}

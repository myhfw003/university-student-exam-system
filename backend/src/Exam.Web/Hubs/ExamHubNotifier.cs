using Exam.Application.Common.Interfaces;
using Exam.Web.Hubs;
using Microsoft.AspNetCore.SignalR;

namespace Exam.Web.Hubs;

/// <summary>
/// 考试实时通知的 SignalR 实现。
/// <para>
/// 应用层只表达「要通知什么」，具体怎么推由 Web 层决定。
/// </para>
/// </summary>
public sealed class ExamHubNotifier : IExamNotifier
{
    private readonly IHubContext<ExamHub> _hub;

    public ExamHubNotifier(IHubContext<ExamHub> hub) => _hub = hub;

    public Task WarnCandidateAsync(long attemptId, string message, CancellationToken cancellationToken = default) =>
        _hub.Clients
            .Group(ExamHub.AttemptGroup(attemptId))
            .SendAsync("ProctorWarning", message, cancellationToken);

    public Task NotifyStateChangedAsync(
        long attemptId,
        string fromStatus,
        string toStatus,
        CancellationToken cancellationToken = default) =>
        _hub.Clients
            .Group(ExamHub.AttemptGroup(attemptId))
            .SendAsync(
                "SessionStateChanged",
                new SessionStateChangedDto(attemptId, fromStatus, toStatus),
                cancellationToken);
}

/// <summary>会话状态变更通知载荷。</summary>
public sealed record SessionStateChangedDto(long AttemptId, string From, string To);

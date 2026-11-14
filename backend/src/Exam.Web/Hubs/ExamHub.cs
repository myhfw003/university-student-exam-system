using Exam.Application.Common.Interfaces;
using Exam.Domain.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Exam.Web.Hubs;

/// <summary>
/// 考试实时通道。考生订阅自己的作答会话，接收警告与状态变更。
/// </summary>
[Authorize]
public sealed class ExamHub : Hub
{
    private readonly IAttemptRepository _attempts;
    private readonly ICurrentUser _currentUser;

    public ExamHub(IAttemptRepository attempts, ICurrentUser currentUser)
    {
        _attempts = attempts;
        _currentUser = currentUser;
    }

    /// <summary>作答会话分组名。</summary>
    public static string AttemptGroup(long attemptId) => $"attempt:{attemptId}";

    /// <summary>加入自己的作答会话。</summary>
    public async Task JoinAttempt(long attemptId)
    {
        var attempt = await _attempts.GetByIdAsync(attemptId, Context.ConnectionAborted);
        if (attempt is null)
        {
            throw new HubException("作答会话不存在。");
        }

        var userId = _currentUser.UserId;
        if (userId != attempt.UserId && !_currentUser.HasPermission(PermissionCatalog.AttemptReadAll))
        {
            throw new HubException("只能订阅自己的作答会话。");
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, AttemptGroup(attemptId));
    }

    /// <summary>离开作答会话。</summary>
    public async Task LeaveAttempt(long attemptId)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, AttemptGroup(attemptId));
    }
}

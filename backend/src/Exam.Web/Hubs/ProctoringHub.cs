using Exam.Application.Common.Interfaces;
using Exam.Domain.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Exam.Web.Hubs;

/// <summary>
/// 监考实时通道。监考教师订阅场次分组，服务端每两秒推一批状态。
/// </summary>
[Authorize(Policy = PermissionCatalog.ProctorMonitor)]
public sealed class ProctoringHub : Hub
{
    private readonly IExamMetrics _metrics;

    public ProctoringHub(IExamMetrics metrics)
    {
        _metrics = metrics;
    }

    /// <summary>连接数是容量指标：连上来就 +1，断开就 -1。</summary>
    public override Task OnConnectedAsync()
    {
        _metrics.SignalRConnected();

        return base.OnConnectedAsync();
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        _metrics.SignalRDisconnected();

        return base.OnDisconnectedAsync(exception);
    }

    /// <summary>场次分组名。</summary>
    public static string ExamGroup(long examSessionId) => $"exam:{examSessionId}";

    /// <summary>以监考身份加入场次。</summary>
    public async Task JoinAsProctor(long examSessionId)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, ExamGroup(examSessionId));
    }

    /// <summary>订阅场次。</summary>
    public async Task SubscribeExam(long examSessionId)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, ExamGroup(examSessionId));
    }

    /// <summary>取消订阅场次。</summary>
    public async Task UnsubscribeExam(long examSessionId)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, ExamGroup(examSessionId));
    }
}

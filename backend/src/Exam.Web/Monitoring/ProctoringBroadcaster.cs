using Exam.Application.Common.Interfaces;
using Exam.Application.Delivery.Services;
using Exam.Domain.Delivery;
using Exam.Web.Hubs;
using Microsoft.AspNetCore.SignalR;

namespace Exam.Web.Monitoring;

/// <summary>
/// 监考状态聚合推送（后台服务）。
/// <para>
/// 每两秒推一批：一个场次一条消息，而不是每个考生一条。
/// 1000 名考生时差别很大——否则监考端每秒要收 500 条消息。
/// </para>
/// </summary>
public sealed class ProctoringBroadcaster : BackgroundService
{
    /// <summary>推送间隔。</summary>
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(2);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IHubContext<ProctoringHub> _hub;
    private readonly ILogger<ProctoringBroadcaster> _logger;

    public ProctoringBroadcaster(
        IServiceScopeFactory scopeFactory,
        IHubContext<ProctoringHub> hub,
        ILogger<ProctoringBroadcaster> logger)
    {
        _scopeFactory = scopeFactory;
        _hub = hub;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval);

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await BroadcastAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                // 推送失败不能拖垮后台服务，下一轮继续。
                _logger.LogError(ex, "监考状态推送失败。");
            }
        }
    }

    private async Task BroadcastAsync(CancellationToken cancellationToken)
    {
        using var scope = _scopeFactory.CreateScope();

        var sessions = scope.ServiceProvider.GetRequiredService<IExamSessionRepository>();
        var monitoring = scope.ServiceProvider.GetRequiredService<ExamMonitoringService>();

        var running = await sessions.ListAsync(ExamSessionStatus.InProgress, null, cancellationToken);

        foreach (var session in running)
        {
            var batch = await monitoring.BuildBatchAsync(session, cancellationToken);

            await _hub.Clients
                .Group(ProctoringHub.ExamGroup(session.Id))
                .SendAsync("ExamStatusBatch", batch, cancellationToken);
        }
    }
}

using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Exam.Worker;

/// <summary>
/// Worker 心跳。用于确认后台进程存活与配置是否正确加载。
/// 真实的定时作业（答卷对账、统计重算、分区维护）在对应模块阶段接入。
/// </summary>
public sealed class WorkerHeartbeatService : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(1);

    private readonly ILogger<WorkerHeartbeatService> _logger;

    public WorkerHeartbeatService(ILogger<WorkerHeartbeatService> logger) => _logger = logger;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("后台作业进程已启动。");

        using var timer = new PeriodicTimer(Interval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            _logger.LogDebug("后台作业心跳。");
        }
    }
}

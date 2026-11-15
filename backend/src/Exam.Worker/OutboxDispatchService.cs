using System.Diagnostics;
using Exam.Application.Common.Interfaces;
using Exam.Application.Messaging;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Exam.Worker;

/// <summary>
/// Outbox 派发。
/// <para>
/// 轮询未派发的领域事件，派给进程内处理器。本期没有外部消息队列，
/// 派发记录落在 outbox_message 上，方便查「发过没有、发成功没有」。
/// </para>
/// </summary>
public sealed class OutboxDispatchService : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(5);

    private readonly IServiceProvider _services;
    private readonly ILogger<OutboxDispatchService> _logger;

    public OutboxDispatchService(IServiceProvider services, ILogger<OutboxDispatchService> logger)
    {
        _services = services;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("领域事件派发进程已启动。");

        using var timer = new PeriodicTimer(Interval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await DispatchAsync(stoppingToken);
        }
    }

    private async Task DispatchAsync(CancellationToken cancellationToken)
    {
        var stopwatch = Stopwatch.StartNew();
        var failed = false;

        try
        {
            using var scope = _services.CreateScope();
            var dispatcher = scope.ServiceProvider.GetRequiredService<IDomainEventDispatcher>();
            var metrics = scope.ServiceProvider.GetRequiredService<IWorkerMetrics>();

            var dispatched = await dispatcher.DispatchPendingAsync(100, cancellationToken);
            if (dispatched > 0)
            {
                _logger.LogInformation("已派发领域事件 {Count} 条。", dispatched);
            }

            // 积压数是告警项（Outbox 积压 > 1000）：每轮采一次。
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var pending = await db.OutboxMessages.CountAsync(m => m.DispatchedAt == null, cancellationToken);
            metrics.SetOutboxPending(pending);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // 关停中，不算错误。
        }
        catch (Exception ex)
        {
            failed = true;
            _logger.LogError(ex, "领域事件派发失败。");
        }
        finally
        {
            using var scope = _services.CreateScope();
            var metrics = scope.ServiceProvider.GetRequiredService<IWorkerMetrics>();
            metrics.RecordBackgroundJob("outbox_dispatch", stopwatch.Elapsed.TotalSeconds, failed);
        }
    }
}

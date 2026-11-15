using System.Diagnostics;
using Exam.Application.Common.Interfaces;
using StackExchange.Redis;

namespace Exam.Web.Observability;

/// <summary>
/// Redis 可用性探测。
/// <para>
/// Redis 在本系统里是「可有可无」的：权限缓存与令牌吊销名单都有进程内兜底，
/// Redis 挂了作答路径仍然能走。所以故障不会自己冒出来——
/// 必须主动探，否则「Redis 已经三小时不可用」这件事没人知道。
/// </para>
/// <para>
/// 采样周期 15 秒，失败连续 1 分钟才告警，给一次网络抖动留出余量。
/// </para>
/// </summary>
public sealed class RedisAvailabilityProbe : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(15);

    private readonly IConnectionMultiplexer _redis;
    private readonly IExamMetrics _metrics;
    private readonly ILogger<RedisAvailabilityProbe> _logger;

    private bool? _lastState;

    public RedisAvailabilityProbe(
        IConnectionMultiplexer redis,
        IExamMetrics metrics,
        ILogger<RedisAvailabilityProbe> logger)
    {
        _redis = redis;
        _metrics = metrics;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval);

        do
        {
            await ProbeAsync(stoppingToken);
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task ProbeAsync(CancellationToken cancellationToken)
    {
        try
        {
            var stopwatch = Stopwatch.StartNew();
            await _redis.GetDatabase().PingAsync();
            stopwatch.Stop();

            _metrics.RecordRedisCommand("ping", stopwatch.Elapsed.TotalSeconds);
            _metrics.SetRedisUp(true);

            if (_lastState == false)
            {
                _logger.LogInformation("Redis 已恢复。");
            }

            _lastState = true;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // 关停中，不算错误。
        }
        catch (Exception ex)
        {
            _metrics.SetRedisUp(false);

            // 只在状态翻转时记日志：Redis 挂一小时不能刷一小时警告。
            if (_lastState != false)
            {
                _logger.LogWarning(
                    ex,
                    "Redis 不可用：权限缓存与令牌吊销名单降级为进程内缓存，作答路径仍可用。");
            }

            _lastState = false;
        }
    }
}

using Exam.Application.Analytics.Services;
using Exam.Application.Common.Interfaces;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Exam.Worker;

/// <summary>
/// 统计读模型重算。
/// <para>
/// 两层刷新：
/// </para>
/// <list type="bullet">
/// <item>**增量**：每隔几分钟扫一遍，只重算「读模型落后于原始数据」的场次。
/// 交卷、改分、发布成绩之后不用等人来点，统计自己就跟上。</item>
/// <item>**全量**：每天把所有场次重算一遍，修正增量可能漏掉或算错的地方。</item>
/// </list>
/// </summary>
public sealed class StatisticsRecalculationService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<StatisticsRecalculationService> _logger;

    public StatisticsRecalculationService(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        ILogger<StatisticsRecalculationService> logger)
    {
        _scopeFactory = scopeFactory;
        _configuration = configuration;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var incrementalInterval = TimeSpan.FromMinutes(
            _configuration.GetValue("Analytics:IncrementalIntervalMinutes", 5));
        var fullInterval = TimeSpan.FromHours(
            _configuration.GetValue("Analytics:FullRecalculationIntervalHours", 24));

        var nextFullRun = DateTimeOffset.UtcNow + fullInterval;

        _logger.LogInformation(
            "统计重算作业已启动：增量间隔 {Incremental}，全量间隔 {Full}。",
            incrementalInterval,
            fullInterval);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunIncrementalAsync(stoppingToken);

                if (DateTimeOffset.UtcNow >= nextFullRun)
                {
                    await RunFullAsync(stoppingToken);
                    nextFullRun = DateTimeOffset.UtcNow + fullInterval;
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "统计重算失败，等下一轮再试。");
            }

            try
            {
                await Task.Delay(incrementalInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    /// <summary>只重算落后于原始数据的场次。</summary>
    private async Task RunIncrementalAsync(CancellationToken cancellationToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var source = scope.ServiceProvider.GetRequiredService<IExamStatisticSource>();
        var service = scope.ServiceProvider.GetRequiredService<ExamStatisticsService>();

        var sessionIds = await source.ListSessionIdsWithAttemptsAsync(cancellationToken);
        var refreshed = 0;

        foreach (var sessionId in sessionIds)
        {
            cancellationToken.ThrowIfCancellationRequested();

            try
            {
                if (!await service.IsStaleAsync(sessionId, cancellationToken))
                {
                    continue;
                }

                await service.RefreshAsync(sessionId, cancellationToken);
                refreshed++;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "场次 {ExamSessionId} 的统计重算失败，跳过。", sessionId);
            }
        }

        if (refreshed > 0)
        {
            _logger.LogInformation("增量统计重算完成，共刷新 {Count} 场考试。", refreshed);
        }
    }

    /// <summary>全部场次重算一遍。</summary>
    private async Task RunFullAsync(CancellationToken cancellationToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var source = scope.ServiceProvider.GetRequiredService<IExamStatisticSource>();
        var service = scope.ServiceProvider.GetRequiredService<ExamStatisticsService>();

        var sessionIds = await source.ListSessionIdsWithAttemptsAsync(cancellationToken);
        var refreshed = 0;

        foreach (var sessionId in sessionIds)
        {
            cancellationToken.ThrowIfCancellationRequested();

            try
            {
                await service.RefreshAsync(sessionId, cancellationToken);
                refreshed++;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "场次 {ExamSessionId} 的全量统计重算失败，跳过。", sessionId);
            }
        }

        _logger.LogInformation("全量统计重算完成，共重算 {Count} 场考试。", refreshed);
    }
}

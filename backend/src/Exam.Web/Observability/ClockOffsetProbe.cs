using System.Data;
using System.Globalization;
using Exam.Application.Common.Interfaces;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Web.Observability;

/// <summary>
/// 应用时钟与数据库时钟的偏差探测。
/// <para>
/// 考试剩余时间由应用判定，提交时间由数据库记录。两者一旦差出秒级，
/// 「还剩多久能交卷」与「库里记的提交时刻」就对不上，
/// 事后申诉与对账都会变成扯皮。
/// </para>
/// <para>
/// 采样周期 30 秒：偏差是慢变量，不需要更密。
/// </para>
/// </summary>
public sealed class ClockOffsetProbe : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(30);

    /// <summary>最近几次的偏差样本。取最小值上报：网络耗时与 GC 停顿只会让偏差变大。</summary>
    private const int SampleWindow = 5;

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IExamMetrics _metrics;
    private readonly ILogger<ClockOffsetProbe> _logger;
    private readonly Queue<double> _samples = new();

    public ClockOffsetProbe(
        IServiceScopeFactory scopeFactory,
        IExamMetrics metrics,
        ILogger<ClockOffsetProbe> logger)
    {
        _scopeFactory = scopeFactory;
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
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            // 取查询前后的中点作为应用时刻：否则来回的网络耗时会被当成时钟偏差。
            var before = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000d;
            var databaseEpoch = await ReadDatabaseEpochAsync(db, cancellationToken);
            var after = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000d;
            var applicationEpoch = (before + after) / 2d;

            var offset = Math.Abs(databaseEpoch - applicationEpoch) * 1000d;

            // 取最近几次的最小值：第一次探测要新建连接，往返耗时会被算成偏差；
            // 直接上报会把「冷启动」报成「时钟偏了 800 毫秒」。
            _samples.Enqueue(offset);

            while (_samples.Count > SampleWindow)
            {
                _samples.Dequeue();
            }

            _metrics.SetClockOffsetMs(_samples.Min());
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // 关停中，不算错误。
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "时钟偏移探测失败。");
        }
    }

    /// <summary>读数据库的墙上时钟（不是事务开始时间）。</summary>
    private static async Task<double> ReadDatabaseEpochAsync(
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var connection = db.Database.GetDbConnection();

        if (connection.State != ConnectionState.Open)
        {
            await connection.OpenAsync(cancellationToken);
        }

        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT extract(epoch FROM clock_timestamp())";

        var value = await command.ExecuteScalarAsync(cancellationToken);

        return Convert.ToDouble(value, CultureInfo.InvariantCulture);
    }
}

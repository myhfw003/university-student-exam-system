using System.Data;
using Exam.Application.Common.Interfaces;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Worker.Observability;

/// <summary>
/// 数据库连接水位采样。
/// <para>
/// 取的是 PostgreSQL 服务端的连接数与上限。Npgsql 没有公开客户端连接池的统计接口，
/// 客户端池水位拿不到；但真正会把数据库压垮的是服务端连接数，
/// 而 pg_stat_activity 与 max_connections 应用账号都读得到。
/// </para>
/// <para>
/// 走 PgBouncer 时看到的是 PgBouncer 的后端连接数——那正是数据库真实承受的压力。
/// </para>
/// </summary>
public sealed class DatabaseConnectionSampler : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(15);

    private const string Sql = """
        SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS active_connections,
               current_setting('max_connections')::int AS max_connections
        """;

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IWorkerMetrics _metrics;
    private readonly ILogger<DatabaseConnectionSampler> _logger;

    public DatabaseConnectionSampler(
        IServiceScopeFactory scopeFactory,
        IWorkerMetrics metrics,
        ILogger<DatabaseConnectionSampler> logger)
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
            await SampleAsync(stoppingToken);
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task SampleAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var connection = db.Database.GetDbConnection();

            if (connection.State != ConnectionState.Open)
            {
                await connection.OpenAsync(cancellationToken);
            }

            await using var command = connection.CreateCommand();
            command.CommandText = Sql;

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);

            if (await reader.ReadAsync(cancellationToken))
            {
                var active = checked((int)reader.GetInt64(0));
                var max = reader.GetInt32(1);

                _metrics.SetDatabaseConnections(active, max);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // 关停中，不算错误。
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "数据库连接水位采样失败。");
        }
    }
}

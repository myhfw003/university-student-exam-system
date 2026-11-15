using Exam.Application.Common.Interfaces;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Exam.Worker.Observability;

/// <summary>
/// 活跃作答会话采样。
/// <para>
/// 「活跃」= 该场次里还在作答、且最近有心跳的考生。判据是心跳新鲜度而不是
/// 「attempt 还是 in_progress」：考生掉线后 attempt 会一直挂在 in_progress，
/// 拿它当活跃数，网关一挂反而看不出掉线；而心跳一停，掉线立刻可见。
/// </para>
/// <para>
/// 采样周期 15 秒。场次不在进行中（窗口关闭或状态变更）时把序列撤掉：
/// 留着 0 值序列，考完之后告警还会拿 0 去比考中的峰值。
/// </para>
/// </summary>
public sealed class ActiveSessionSampler : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(15);

    /// <summary>
    /// 心跳新鲜度取场次自己的超时配置（心跳间隔 15 秒、超时 45 秒是默认），
    /// 下限 45 秒：网络差的学生不该因为一次丢包就被算成掉线。
    /// </summary>
    private const string Sql = """
        SELECT s.id AS session_id,
               count(a.id) FILTER (
                   WHERE a.status = 'in_progress'
                     AND a.last_heartbeat_at IS NOT NULL
                     AND a.last_heartbeat_at > now() - (
                         greatest(
                             CASE
                                 WHEN coalesce(s.rules ->> 'HeartbeatTimeoutSeconds',
                                              s.rules ->> 'heartbeatTimeoutSeconds') ~ '^[0-9]+$'
                                 THEN (coalesce(s.rules ->> 'HeartbeatTimeoutSeconds',
                                                s.rules ->> 'heartbeatTimeoutSeconds'))::int
                                 ELSE 45
                             END,
                             45) * interval '1 second')
               ) AS active_count
        FROM delivery.exam_session s
        LEFT JOIN delivery.attempt a
               ON a.exam_session_id = s.id
              AND a.deleted_at IS NULL
        WHERE s.status = 'in_progress'
          AND s.deleted_at IS NULL
          AND s.open_at <= now()
          AND s.close_at > now()
        GROUP BY s.id
        """;

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IWorkerMetrics _metrics;
    private readonly ILogger<ActiveSessionSampler> _logger;

    /// <summary>上一轮发布过的场次。下一轮不在其中，就把序列撤掉。</summary>
    private readonly HashSet<long> _published = [];

    private int _lastActive = -1;
    private int _lastSessionCount = -1;

    public ActiveSessionSampler(
        IServiceScopeFactory scopeFactory,
        IWorkerMetrics metrics,
        ILogger<ActiveSessionSampler> logger)
    {
        _scopeFactory = scopeFactory;
        _metrics = metrics;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("活跃会话采样已启动：间隔 {Interval}。", Interval);

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

            var current = await QueryAsync(db, cancellationToken);

            foreach (var (sessionId, count) in current)
            {
                _metrics.SetActiveSessions(sessionId, count);
            }

            foreach (var sessionId in _published.Except(current.Keys))
            {
                _metrics.RemoveActiveSessions(sessionId);
            }

            _published.Clear();
            _published.UnionWith(current.Keys);

            var active = current.Values.Sum();

            if (active != _lastActive || current.Count != _lastSessionCount)
            {
                _lastActive = active;
                _lastSessionCount = current.Count;

                _logger.LogInformation(
                    "活跃会话采样：{Sessions} 场考试在监，活跃会话 {Active} 个。",
                    current.Count,
                    active);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // 关停中，不算错误。
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "活跃会话采样失败。");
        }
    }

    private static async Task<Dictionary<long, int>> QueryAsync(
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var result = new Dictionary<long, int>();
        var connection = db.Database.GetDbConnection();

        if (connection.State != System.Data.ConnectionState.Open)
        {
            await connection.OpenAsync(cancellationToken);
        }

        await using var command = connection.CreateCommand();
        command.CommandText = Sql;

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        while (await reader.ReadAsync(cancellationToken))
        {
            var sessionId = reader.GetInt64(0);

            // count() 在 PostgreSQL 里是 bigint，按 int32 读会抛类型转换异常。
            var count = checked((int)reader.GetInt64(1));
            result[sessionId] = count;
        }

        return result;
    }
}

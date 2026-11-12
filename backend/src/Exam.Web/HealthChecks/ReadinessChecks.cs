using Microsoft.Extensions.Diagnostics.HealthChecks;
using StackExchange.Redis;

namespace Exam.Web.HealthChecks;

/// <summary>PostgreSQL 就绪检查。数据库不可用时实例不就绪。</summary>
public sealed class PostgreSqlReadinessCheck : IHealthCheck
{
    private readonly Npgsql.NpgsqlDataSource _dataSource;

    public PostgreSqlReadinessCheck(Npgsql.NpgsqlDataSource dataSource) => _dataSource = dataSource;

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        try
        {
            await using var command = _dataSource.CreateCommand("SELECT 1");
            await command.ExecuteNonQueryAsync(cancellationToken);
            return HealthCheckResult.Healthy("数据库可用。");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy("数据库不可用。", ex);
        }
    }
}

/// <summary>
/// Redis 就绪检查。Redis 故障时判定为降级但仍为「就绪」——
/// 作答链路不依赖 Redis 强一致（P-07），不应因 Redis 摘除正在承载考试的实例。
/// </summary>
public sealed class RedisReadinessCheck : IHealthCheck
{
    private readonly IConnectionMultiplexer _redis;

    public RedisReadinessCheck(IConnectionMultiplexer redis) => _redis = redis;

    public Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var ping = _redis.GetDatabase().Ping();
            return Task.FromResult(HealthCheckResult.Healthy($"Redis 可用，延迟 {ping.TotalMilliseconds:F1} 毫秒。"));
        }
        catch (Exception ex)
        {
            return Task.FromResult(HealthCheckResult.Degraded("Redis 不可用，已降级为内存吊销名单。", ex));
        }
    }
}

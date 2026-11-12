using System.Collections.Concurrent;
using Exam.Application.Common.Interfaces;
using StackExchange.Redis;
using Microsoft.Extensions.Logging;

namespace Exam.Infrastructure.Caching;

/// <summary>
/// 访问令牌吊销名单。
/// <para>内存名单始终生效（单实例可用），Redis 为可选的跨实例共享层。
/// Redis 不可用时降级为"内存名单 + 放行"，只记录告警——不因 Redis 故障让整个系统不可用。</para>
/// </summary>
public sealed class HybridTokenBlacklist : ITokenBlacklist
{
    private const string RedisKeyPrefix = "exam:token:blacklist:";

    private readonly ConcurrentDictionary<string, DateTimeOffset> _local = new(StringComparer.Ordinal);
    private readonly IConnectionMultiplexer? _redis;
    private readonly ILogger<HybridTokenBlacklist> _logger;

    public HybridTokenBlacklist(
        ILogger<HybridTokenBlacklist> logger,
        IConnectionMultiplexer? redis = null)
    {
        _logger = logger;
        _redis = redis;
    }

    public async Task RevokeAsync(string jti, DateTimeOffset expiresAt, CancellationToken cancellationToken = default)
    {
        _local[jti] = expiresAt;

        if (_redis is null)
        {
            return;
        }

        try
        {
            var db = _redis.GetDatabase();
            var ttl = expiresAt - DateTimeOffset.UtcNow;
            if (ttl > TimeSpan.Zero)
            {
                await db.StringSetAsync($"{RedisKeyPrefix}{jti}", "1", ttl);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "写入令牌吊销名单失败，已降级为内存名单。");
        }
    }

    public async Task<bool> IsRevokedAsync(string jti, CancellationToken cancellationToken = default)
    {
        if (_local.TryGetValue(jti, out var expiry))
        {
            if (expiry > DateTimeOffset.UtcNow)
            {
                return true;
            }

            _local.TryRemove(jti, out _);
        }

        if (_redis is null)
        {
            return false;
        }

        try
        {
            var db = _redis.GetDatabase();
            return await db.KeyExistsAsync($"{RedisKeyPrefix}{jti}");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "查询令牌吊销名单失败，本次按未吊销处理。");
            return false;
        }
    }
}

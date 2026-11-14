using System.Collections.Concurrent;
using Exam.Application.Common.Interfaces;
using StackExchange.Redis;
using Microsoft.Extensions.Logging;

namespace Exam.Infrastructure.Caching;

/// <summary>
/// 访问令牌吊销名单。
/// <para>
/// 内存名单始终生效（单实例可用），Redis 为可选的跨实例共享层。
/// Redis 不可用时降级为"内存名单 + 放行"，只记录告警——不因 Redis 故障让整个系统不可用。</para>
/// </summary>
public sealed class HybridTokenBlacklist : ITokenBlacklist
{
    /// <summary>用户级吊销记录在内存中的最长保留时间。超过后令牌本身也已过期。</summary>
    private static readonly TimeSpan UserRevocationRetention = TimeSpan.FromHours(2);

    private readonly ConcurrentDictionary<string, DateTimeOffset> _local = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<long, DateTimeOffset> _localUsers = new();
    private readonly IConnectionMultiplexer? _redis;
    private readonly RedisCacheNamespace _namespace;
    private readonly ILogger<HybridTokenBlacklist> _logger;

    public HybridTokenBlacklist(
        RedisCacheNamespace redisNamespace,
        ILogger<HybridTokenBlacklist> logger,
        IConnectionMultiplexer? redis = null)
    {
        _namespace = redisNamespace;
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
                await db.StringSetAsync(_namespace.Key($"token:blacklist:{jti}"), "1", ttl);
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
            return await db.KeyExistsAsync(_namespace.Key($"token:blacklist:{jti}"));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "查询令牌吊销名单失败，本次按未吊销处理。");
            return false;
        }
    }

    /// <summary>
    /// 吊销某用户在 <paramref name="validAfter"/> 之前签发的全部访问令牌。
    /// 记录的是「签发时间下界」，而不是令牌清单——令牌数量未知也无需枚举。
    /// </summary>
    public async Task RevokeUserAsync(
        long userId,
        DateTimeOffset validAfter,
        CancellationToken cancellationToken = default)
    {
        _localUsers[userId] = validAfter;

        if (_redis is null)
        {
            return;
        }

        try
        {
            var db = _redis.GetDatabase();
            await db.StringSetAsync(
                _namespace.Key($"token:user:{userId}"),
                validAfter.ToUnixTimeMilliseconds().ToString(),
                UserRevocationRetention);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "写入用户级令牌吊销记录失败，已降级为内存名单。");
        }
    }

    public async Task<bool> IsUserRevokedAsync(
        long userId,
        DateTimeOffset issuedAt,
        CancellationToken cancellationToken = default)
    {
        if (_localUsers.TryGetValue(userId, out var localValidAfter) && issuedAt < localValidAfter)
        {
            return true;
        }

        if (_redis is null)
        {
            return false;
        }

        try
        {
            var db = _redis.GetDatabase();
            var value = await db.StringGetAsync(_namespace.Key($"token:user:{userId}"));
            if (!value.HasValue)
            {
                return false;
            }

            if (!long.TryParse(value.ToString(), out var validAfterUnixMs))
            {
                return false;
            }

            return issuedAt < DateTimeOffset.FromUnixTimeMilliseconds(validAfterUnixMs);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "查询用户级令牌吊销记录失败，本次按未吊销处理。");
            return false;
        }
    }
}

using System.Collections.Concurrent;
using System.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Exam.Application.Common.Interfaces;
using StackExchange.Redis;
using Microsoft.Extensions.Logging;

namespace Exam.Infrastructure.Caching;

/// <summary>
/// 用户权限的实时读取与缓存。
/// <para>
/// 令牌里的权限声明只是签发时的快照，不能作为授权依据——否则角色调整要等到令牌过期才生效。
/// 这里按需读库并缓存，角色变更时显式失效缓存，保证「下次请求即生效」。
/// </para>
/// <para>
/// 缓存分两层：进程内字典（快）与 Redis（跨实例共享）。Redis 不可用时自动降级为进程内缓存。
/// </para>
/// </summary>
public sealed class CachedPermissionProvider : IPermissionProvider
{
    /// <summary>缓存有效期。角色变更会主动失效，因此有效期只用于兜底。</summary>
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(10);

    /// <summary>
    /// 进程内缓存。服务注册为单例，缓存随实例存活——
    /// 若按 Scoped 注册，每个请求都会重建缓存，等于没有缓存。
    /// </summary>
    private readonly ConcurrentDictionary<long, CacheEntry> _local = new();
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConnectionMultiplexer? _redis;
    private readonly RedisCacheNamespace _namespace;
    private readonly ILogger<CachedPermissionProvider> _logger;
    private readonly IExamMetrics? _metrics;

    public CachedPermissionProvider(
        IServiceScopeFactory scopeFactory,
        RedisCacheNamespace redisNamespace,
        ILogger<CachedPermissionProvider> logger,
        IConnectionMultiplexer? redis = null,
        IExamMetrics? metrics = null)
    {
        _scopeFactory = scopeFactory;
        _namespace = redisNamespace;
        _logger = logger;
        _redis = redis;
        _metrics = metrics;
    }

    public async Task<IReadOnlySet<string>> GetPermissionsAsync(
        long userId,
        CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.UtcNow;

        if (_local.TryGetValue(userId, out var entry) && entry.ExpiresAt > now)
        {
            return entry.Permissions;
        }

        var fromRedis = await TryReadRedisAsync(userId);
        if (fromRedis is not null)
        {
            _local[userId] = new CacheEntry(fromRedis, now.Add(CacheTtl));
            return fromRedis;
        }

        // 权限查询需要 DbContext（Scoped），在这里开一个短生命周期的作用域读取。
        using var scope = _scopeFactory.CreateScope();
        var permissions = scope.ServiceProvider.GetRequiredService<IUserPermissionService>();
        var codes = await permissions.GetPermissionCodesAsync(userId, cancellationToken);
        var set = new HashSet<string>(codes, StringComparer.Ordinal);

        _local[userId] = new CacheEntry(set, now.Add(CacheTtl));
        await TryWriteRedisAsync(userId, set, now);

        return set;
    }

    public async Task InvalidateAsync(long userId, CancellationToken cancellationToken = default)
    {
        _local.TryRemove(userId, out _);

        if (_redis is null)
        {
            return;
        }

        var stopwatch = Stopwatch.StartNew();

        try
        {
            await _redis.GetDatabase().KeyDeleteAsync(_namespace.Key($"perm:{userId}"));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "失效用户权限缓存失败，已清除进程内缓存。");
        }
        finally
        {
            _metrics?.RecordRedisCommand("permission_delete", stopwatch.Elapsed.TotalSeconds);
        }
    }

    private async Task<HashSet<string>?> TryReadRedisAsync(long userId)
    {
        if (_redis is null)
        {
            return null;
        }

        var stopwatch = Stopwatch.StartNew();

        try
        {
            var value = await _redis.GetDatabase().StringGetAsync(_namespace.Key($"perm:{userId}"));
            if (!value.HasValue)
            {
                return null;
            }

            var parts = value.ToString().Split('|', StringSplitOptions.RemoveEmptyEntries);
            return new HashSet<string>(parts, StringComparer.Ordinal);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "读取用户权限缓存失败，回落到数据库。");
            return null;
        }
        finally
        {
            _metrics?.RecordRedisCommand("permission_get", stopwatch.Elapsed.TotalSeconds);
        }
    }

    private async Task TryWriteRedisAsync(long userId, HashSet<string> permissions, DateTimeOffset now)
    {
        if (_redis is null)
        {
            return;
        }

        var stopwatch = Stopwatch.StartNew();

        try
        {
            await _redis.GetDatabase().StringSetAsync(
                _namespace.Key($"perm:{userId}"),
                string.Join('|', permissions),
                CacheTtl);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "写入用户权限缓存失败，本次仅使用进程内缓存。");
        }
        finally
        {
            _metrics?.RecordRedisCommand("permission_set", stopwatch.Elapsed.TotalSeconds);
        }
    }

    private sealed record CacheEntry(IReadOnlySet<string> Permissions, DateTimeOffset ExpiresAt);
}

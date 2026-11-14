using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Npgsql;

namespace Exam.Infrastructure.Caching;

/// <summary>
/// Redis 键的命名空间。
/// <para>
/// 缓存键必须按「环境 + 数据库」隔离：同一个 Redis 实例可能同时服务开发、测试与生产，
/// 甚至多个互不相干的数据库。不加前缀时，A 环境缓存的用户权限会被 B 环境读走，
/// 直接导致越权或误拒。这里把环境名与数据库地址纳入键前缀。
/// </para>
/// </summary>
public sealed class RedisCacheNamespace
{
    private readonly string _prefix;

    public RedisCacheNamespace(IHostEnvironment environment, IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("Database");
        var target = DescribeTarget(connectionString);
        _prefix = $"exam:{environment.EnvironmentName}:{target}";
    }

    /// <summary>生成带命名空间的完整键。</summary>
    public string Key(string suffix) => $"{_prefix}:{suffix}";

    /// <summary>描述数据库目标：主机:端口/库名。取不到时退化为 "unknown"。</summary>
    private static string DescribeTarget(string? connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return "unknown";
        }

        try
        {
            var builder = new NpgsqlConnectionStringBuilder(connectionString);
            var host = string.IsNullOrWhiteSpace(builder.Host) ? "unknown" : builder.Host;
            var port = builder.Port > 0 ? builder.Port : 5432;
            var database = string.IsNullOrWhiteSpace(builder.Database) ? "unknown" : builder.Database;
            return $"{host}:{port}/{database}";
        }
        catch (ArgumentException)
        {
            // 连接串格式异常时退化为哈希，避免因命名空间计算失败影响启动。
            return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
                System.Text.Encoding.UTF8.GetBytes(connectionString)))[..16].ToLowerInvariant();
        }
    }
}

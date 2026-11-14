using Exam.Application.Common.Interfaces;
using Exam.Infrastructure.Audit;
using Exam.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace Exam.Web.FunctionalTests;

/// <summary>
/// 功能测试宿主。数据库由测试夹具提供（真实的 PostgreSQL 17 容器），
/// 这里只负责把连接串与配置注入 Web 宿主。
/// 不用 SQLite——jsonb、递归 CTE、部分索引等特性无法等价。
/// </summary>
public sealed class ExamWebFactory : WebApplicationFactory<Program>
{
    private readonly string _connectionString;
    private readonly string _redisConnectionString;

    public ExamWebFactory(string connectionString, string? redisConnectionString = null)
    {
        _connectionString = connectionString;
        _redisConnectionString = redisConnectionString ?? "localhost:6379,abortConnect=false";
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");

        builder.ConfigureAppConfiguration((_, configuration) =>
        {
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Database"] = _connectionString,
                ["ConnectionStrings:Redis"] = _redisConnectionString,
                ["Jwt:Issuer"] = "exam",
                ["Jwt:Audience"] = "exam-web",
                ["Jwt:RefreshTokenPepper"] = "test-pepper",
                ["RateLimiting:GlobalPerMinute"] = "100000",
            });
        });

        builder.ConfigureServices(services =>
        {
            // 容器连接串在配置里给出，但默认注册发生在更早，需要替换。
            // EF 9+ 把 DbContext 选项拆成 IDbContextOptionsConfiguration，
            // 只移除 DbContextOptions 不会移除原配置——那会让默认连接串与拦截器叠加生效。
            services.RemoveAll<Microsoft.EntityFrameworkCore.Infrastructure.IDbContextOptionsConfiguration<AppDbContext>>();
            services.RemoveAll<DbContextOptions<AppDbContext>>();
            services.RemoveAll<AppDbContext>();
            // 真实实现是 MinIO；测试用内存实现，不需要真对象存储。
            services.RemoveAll<IObjectStorage>();
            services.AddSingleton<IObjectStorage, InMemoryObjectStorage>();

            services.AddDbContext<AppDbContext>((sp, options) =>
                options.UseNpgsql(_connectionString)
                    .UseSnakeCaseNamingConvention()
                    // 与生产装配保持一致：实体字段变更的自动留痕
                    .AddInterceptors(sp.GetRequiredService<AuditSaveChangesInterceptor>()));
        });
    }
}

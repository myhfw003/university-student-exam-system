using Exam.Application.Catalog.Services;
using Exam.Application.Common.Interfaces;
using Exam.Infrastructure.Audit;
using Exam.Infrastructure.Messaging;
using Exam.Infrastructure.Persistence;
using Microsoft.AspNetCore.Builder;
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
    /// <summary>
    /// 测试用的 AI 供应商。真实实现要发 HTTP 调模型，功能测试里换成可控的假货：
    /// 模型返回什么由测试自己写，生成的请求也留着可查。
    /// </summary>
    internal StubAiProvider AiProvider { get; } = new();

    private readonly string _connectionString;
    private readonly string _redisConnectionString;
    private readonly IDictionary<string, string?> _configuration;

    /// <param name="configuration">
    /// 追加的配置项（如限流阈值），会覆盖 appsettings.json 里的同名键。
    /// </param>
    public ExamWebFactory(
        string connectionString,
        string? redisConnectionString = null,
        IDictionary<string, string?>? configuration = null)
    {
        _connectionString = connectionString;
        _redisConnectionString = redisConnectionString ?? "localhost:6379,abortConnect=false";
        _configuration = configuration ?? new Dictionary<string, string?>();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");

        builder.ConfigureAppConfiguration((_, configuration) =>
        {
            var values = new Dictionary<string, string?>
            {
                ["ConnectionStrings:Database"] = _connectionString,
                ["ConnectionStrings:Redis"] = _redisConnectionString,
                ["Jwt:Issuer"] = "exam",
                ["Jwt:Audience"] = "exam-web",
                ["Jwt:RefreshTokenPepper"] = "test-pepper",
                // 功能测试不验限流：整个测试类的请求都来自同一个 IP，
                // 按「登录 10 次/分钟/IP」的阈值会互相踩。
                // 限流本身由 RateLimitTests 自己配阈值单独验。
                ["RateLimiting:LoginPerIpPerMinute"] = "100000",
                ["RateLimiting:LoginPerAccountPerMinute"] = "100000",
                ["RateLimiting:AnswersPerUserPerMinute"] = "100000",
                ["RateLimiting:FocusEventsPerUserPerMinute"] = "100000",
                ["RateLimiting:WritesPerUserPerMinute"] = "100000",
                ["RateLimiting:ReadsPerMinute"] = "1000000",
            };

            // 测试要临时改限流阈值：改完只在这一个宿主里生效。
            foreach (var (key, value) in _configuration)
            {
                values[key] = value;
            }

            configuration.AddInMemoryCollection(values);
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

            // 真实的 AI 供应商要发 HTTP 调模型服务；测试换成可控的假供应商。
            services.RemoveAll<IQuestionGenerationProvider>();
            services.AddSingleton<IQuestionGenerationProvider>(AiProvider);

            // 测试专用的「来源地址」注入：TestServer 没有真实的远端地址，
            // 验证受信任代理的边界时需要模拟「请求来自某个地址」。
            // 用启动过滤器插到管线最前面——转发头处理在它之后才对。
            services.AddTransient<IStartupFilter, TestRemoteIpStartupFilter>();

            services.AddDbContext<AppDbContext>((sp, options) =>
                options.UseNpgsql(_connectionString)
                    .UseSnakeCaseNamingConvention()
                    // 与生产装配保持一致：实体字段变更的自动留痕 + 领域事件出站
                    .AddInterceptors(
                        sp.GetRequiredService<AuditSaveChangesInterceptor>(),
                        sp.GetRequiredService<OutboxSaveChangesInterceptor>()));
        });
    }
}

/// <summary>
/// 把请求头 <c>X-Test-Remote-Ip</c> 指的地址设成连接的对端地址。
/// <para>
/// 只在功能测试宿主里注册：TestServer 默认没有对端地址，
/// 而「来源地址不在受信任网段时转发头一律不认」这条边界必须有真实对端才验得了。
/// </para>
/// </summary>
internal sealed class TestRemoteIpStartupFilter : IStartupFilter
{
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        app.Use(async (context, nextMiddleware) =>
        {
            if (context.Request.Headers.TryGetValue("X-Test-Remote-Ip", out var value)
                && System.Net.IPAddress.TryParse(value.ToString(), out var address))
            {
                context.Connection.RemoteIpAddress = address;
            }

            await nextMiddleware();
        });

        next(app);
    };
}

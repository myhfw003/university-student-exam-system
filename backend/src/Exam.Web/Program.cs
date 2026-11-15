using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Threading.RateLimiting;
using Exam.Application;
using Exam.Application.Common.Interfaces;
using Exam.Infrastructure;
using Exam.Infrastructure.Identity;
using Exam.Infrastructure.Observability;
using Exam.Web.HealthChecks;
using Exam.Web.Hubs;
using Exam.Web.Monitoring;
using Exam.Web.Observability;
using Exam.Web.Middleware;
using Exam.Web.Security;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using Prometheus;
using Serilog;

// 健康检查模式：容器 healthcheck 用。
// 不能直接启动整个应用（会与已运行的实例争抢端口），这里只发一个探测请求。
if (args.Contains("--health-check", StringComparer.OrdinalIgnoreCase))
{
    Environment.Exit(await HealthCheckProbe.RunAsync(args));
}

var builder = WebApplication.CreateBuilder(args);

// ---------------------------------------------------------------- 日志
builder.Host.UseSerilog((context, services, configuration) => configuration
    .ReadFrom.Configuration(context.Configuration)
    .ReadFrom.Services(services)
    .Enrich.FromLogContext()
    .Enrich.WithProperty("Application", "exam-web")
    .WriteTo.Console(new Serilog.Formatting.Compact.CompactJsonFormatter()));

// ---------------------------------------------------------------- 应用层与基础设施
builder.Services.AddExamApplication();
builder.Services.AddExamInfrastructure(builder.Configuration);

// 业务指标只在 API 进程采集。Worker 侧的指标在 Worker 进程独立注册：
// 同一个指标名被两个进程各报一次，告警里的比例就凭空翻倍。
builder.Services.AddSingleton<IExamMetrics>(_ => new ExamMetrics(Metrics.DefaultFactory));

// ---------------------------------------------------------------- Web 层抽象
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, HttpCurrentUser>();
builder.Services.AddScoped<IRequestContext, HttpRequestContext>();

// ---------------------------------------------------------------- 控制器
builder.Services.AddControllers();

// ---------------------------------------------------------------- 实时通道（SignalR）
// 多实例部署时靠 Redis Backplane 广播，客户端不必连到同一台机器。
// 连接复用基础设施已注册的那个 Redis 连接 multiplexer。
// 监考状态每两秒聚合推送一批。
builder.Services.AddHostedService<ProctoringBroadcaster>();

// 依赖探测：时钟偏移与 Redis 可用性。两者都是「不出故障就没有告警」
// 的指标，所以要自己定时去探，而不是等业务请求带出数据。
builder.Services.AddHostedService<ClockOffsetProbe>();
builder.Services.AddHostedService<RedisAvailabilityProbe>();

// 考试实时通知走 SignalR。
builder.Services.AddSingleton<Exam.Application.Common.Interfaces.IExamNotifier, ExamHubNotifier>();

IServiceProvider? rootProvider = null;
builder.Services
    .AddSignalR()
    .AddStackExchangeRedis(options =>
    {
        options.Configuration.ChannelPrefix = StackExchange.Redis.RedisChannel.Literal("exam-signalr");
        options.ConnectionFactory = _ =>
        {
            var multiplexer = rootProvider!.GetRequiredService<StackExchange.Redis.IConnectionMultiplexer>();
            return Task.FromResult(multiplexer);
        };
    });

// ---------------------------------------------------------------- 认证与授权
var jwtOptions = builder.Configuration.GetSection("Jwt").Get<Exam.Infrastructure.Configuration.JwtOptions>()
    ?? new Exam.Infrastructure.Configuration.JwtOptions();

// 签名密钥提供器需要提前构造：签发方与校验方必须共用同一把密钥。
var keyProvider = new JwtKeyProvider(Options.Create(jwtOptions));
builder.Services.AddSingleton(keyProvider);

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwtOptions.Issuer,
            ValidateAudience = true,
            ValidAudience = jwtOptions.Audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = keyProvider.PublicKey,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromSeconds(30),
            NameClaimType = "unique_name",
        };

        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                // SignalR 的 WebSocket 握手带不了 Authorization 头，
                // 约定用 ?access_token= 传令牌。
                var accessToken = context.Request.Query["access_token"];
                if (!string.IsNullOrWhiteSpace(accessToken)
                    && context.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                {
                    context.Token = accessToken;
                }

                return Task.CompletedTask;
            },
            OnTokenValidated = async context =>
            {
                var jti = context.Principal?.FindFirst("jti")?.Value;
                if (string.IsNullOrWhiteSpace(jti))
                {
                    return;
                }

                var blacklist = context.HttpContext.RequestServices.GetRequiredService<ITokenBlacklist>();
                if (await blacklist.IsRevokedAsync(jti, context.HttpContext.RequestAborted))
                {
                    context.Fail("访问令牌已被吊销。");
                    return;
                }

                // 账号被禁用时，其已签发的访问令牌立即失效，不必等令牌自然过期。
                var subject = context.Principal?.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                    ?? context.Principal?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
                var issuedAt = context.Principal?.FindFirst(JwtRegisteredClaimNames.Iat)?.Value;

                if (long.TryParse(subject, out var userId)
                    && long.TryParse(issuedAt, out var issuedAtUnixSeconds))
                {
                    var issuedAtUtc = DateTimeOffset.FromUnixTimeSeconds(issuedAtUnixSeconds);
                    if (await blacklist.IsUserRevokedAsync(userId, issuedAtUtc, context.HttpContext.RequestAborted))
                    {
                        context.Fail("账号已被禁用。");
                    }
                }
            },
        };
    });

builder.Services.AddAuthorization();
builder.Services.AddSingleton<DefaultAuthorizationPolicyProvider>();
builder.Services.AddSingleton<IAuthorizationPolicyProvider, PermissionPolicyProvider>();
builder.Services.AddSingleton<IAuthorizationHandler, PermissionAuthorizationHandler>();

// ---------------------------------------------------------------- 限流
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
    {
        // 健康检查与指标不参与限流：探针被限流，容器会被判成不健康。
        var path = context.Request.Path.Value ?? string.Empty;
        if (path.StartsWith("/health", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/metrics", StringComparison.OrdinalIgnoreCase))
        {
            return RateLimitPartition.GetNoLimiter("probe");
        }

        // 阈值在请求时读配置：配置改完立刻生效，不用重启。
        var permitLimit = context.RequestServices
            .GetRequiredService<IConfiguration>()
            .GetValue("RateLimiting:GlobalPerMinute", 6000);

        return RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = permitLimit,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            });
    });
});

// ---------------------------------------------------------------- CORS
var allowedOrigins = builder.Configuration.GetSection("CORS:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
{
    if (allowedOrigins.Length > 0)
    {
        policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod().AllowCredentials();
    }
    else
    {
        policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod();
    }
}));

// ---------------------------------------------------------------- 可观测性
var serviceName = builder.Configuration.GetValue("OpenTelemetry:ServiceName", "exam-web");
builder.Services.AddOpenTelemetry()
    .ConfigureResource(resource => resource.AddService(serviceName))
    .WithTracing(tracing => tracing
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddOtlpExporter())
    .WithMetrics(metrics => metrics
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddOtlpExporter());

// ---------------------------------------------------------------- 健康检查
builder.Services.AddHealthChecks()
    .AddCheck<PostgreSqlReadinessCheck>("postgres", tags: ["ready"])
    .AddCheck<RedisReadinessCheck>("redis", tags: ["ready"]);

var app = builder.Build();
rootProvider = app.Services;

if (keyProvider.IsEphemeral)
{
    app.Logger.LogWarning("未配置 Jwt:SigningPrivateKeyPem，已临时生成开发密钥。重启后已签发的令牌全部失效。");
}

// ---------------------------------------------------------------- 管线（顺序敏感）
app.UseSerilogRequestLogging(options =>
{
    options.GetLevel = (httpContext, _, ex) =>
        ex is not null || httpContext.Response.StatusCode >= 500 ? Serilog.Events.LogEventLevel.Error : Serilog.Events.LogEventLevel.Debug;
});

app.UseMiddleware<ExceptionHandlingMiddleware>();
// 请求指标：路由标签取路由模板，原始路径不进指标。
app.UseMiddleware<HttpMetricsMiddleware>();
app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
});
app.UseCors();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<ProctoringHub>("/hubs/proctoring");
app.MapHub<ExamHub>("/hubs/exam");

app.MapHealthChecks("/health/live", new HealthCheckOptions { Predicate = _ => false });
app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = c => c.Tags.Contains("ready") });
app.MapHealthChecks("/health/startup", new HealthCheckOptions { Predicate = _ => false });

app.MapMetrics();

// 业务指标要先建好：即使还没发生过保存答案，/metrics 也要把指标名列出来，
// 告警表达式才不会因为「指标不存在」而失效。
_ = app.Services.GetRequiredService<IExamMetrics>();

app.Run();

/// <summary>供 WebApplicationFactory 使用的入口标记。</summary>
public partial class Program;

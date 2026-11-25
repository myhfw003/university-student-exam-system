using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Threading.RateLimiting;
using Exam.Application;
using Exam.Application.Common.Interfaces;
using Exam.Application.Common.Security;
using Exam.Application.Identity.Commands;
using Exam.Application.Settings.Commands;
using Exam.Infrastructure;
using Exam.Infrastructure.Identity;
using Exam.Infrastructure.Observability;
using Exam.Web.HealthChecks;
using Exam.Web.Hubs;
using Exam.Web.Monitoring;
using Exam.Web.Observability;
using Exam.Web.Middleware;
using Exam.Web.RateLimiting;
using Exam.Web.Security;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.OpenApi;
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

// OpenAPI 导出模式：生成 API 契约文件（docs/api/openapi.json）后退出，不常驻。
// 契约从运行中的应用里取，保证与 Swagger UI 看到的是同一份。
var exportOpenApiIndex = Array.FindIndex(
    args,
    a => string.Equals(a, "--export-openapi", StringComparison.OrdinalIgnoreCase));
string? exportOpenApiPath = exportOpenApiIndex >= 0
    ? (exportOpenApiIndex + 1 < args.Length ? args[exportOpenApiIndex + 1] : "openapi.json")
    : null;

var builder = WebApplication.CreateBuilder(args);

if (exportOpenApiPath is not null)
{
    // 导出模式不连数据库与 Redis，但 JWT 选项在启动时校验，先给上默认值。
    builder.Configuration["Jwt:Issuer"] ??= "exam";
    builder.Configuration["Jwt:Audience"] ??= "exam-web";
    builder.Configuration["Jwt:AccessTokenMinutes"] ??= "15";
    builder.Configuration["Jwt:RefreshTokenDays"] ??= "7";

    // 固定端口：导出过程要真的起一次应用取契约。
    builder.WebHost.UseUrls("http://127.0.0.1:5199");
}

// ---------------------------------------------------------------- 日志
builder.Host.UseSerilog((context, services, configuration) => configuration
    .ReadFrom.Configuration(context.Configuration)
    .ReadFrom.Services(services)
    .Enrich.FromLogContext()
    .Enrich.WithProperty("Application", "exam-web")
    // 密码与令牌不进日志（FR-AUD-02 / 安全合规 §8.4）：
    // 这些命令对象一旦被人记进日志，密钥就跟着出去了。
    .Destructure.ByTransforming<LoginCommand>(cmd =>
        new { cmd.Username, Password = SensitiveDataMasker.MaskSecret(cmd.Password) })
    .Destructure.ByTransforming<ChangeOwnPasswordCommand>(cmd =>
        new
        {
            CurrentPassword = SensitiveDataMasker.MaskSecret(cmd.CurrentPassword),
            NewPassword = SensitiveDataMasker.MaskSecret(cmd.NewPassword),
        })
    .Destructure.ByTransforming<ResetUserPasswordCommand>(cmd => new { cmd.Id })
    .Destructure.ByTransforming<SetOriginalPasswordCommand>(cmd =>
        new { Password = SensitiveDataMasker.MaskSecret(cmd.Password) })
    .Destructure.ByTransforming<CreateUserCommand>(cmd =>
        new
        {
            cmd.Username,
            cmd.DisplayName,
            cmd.Email,
            Phone = SensitiveDataMasker.MaskPhone(cmd.Phone),
            Password = SensitiveDataMasker.MaskSecret(cmd.Password),
            cmd.RoleIds,
        })
    .Destructure.ByTransforming<UpdateUserCommand>(cmd =>
        new
        {
            cmd.DisplayName,
            cmd.Email,
            Phone = SensitiveDataMasker.MaskPhone(cmd.Phone),
            cmd.Status,
            cmd.DisableReason,
        })
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
// 导出模式不启动后台服务：它们要连数据库与 Redis，导出契约不需要。
if (exportOpenApiPath is null)
{
    builder.Services.AddHostedService<ProctoringBroadcaster>();
}

// 依赖探测：时钟偏移与 Redis 可用性。两者都是「不出故障就没有告警」
// 的指标，所以要自己定时去探，而不是等业务请求带出数据。
if (exportOpenApiPath is null)
{
    builder.Services.AddHostedService<ClockOffsetProbe>();
    builder.Services.AddHostedService<RedisAvailabilityProbe>();
}

// 考试实时通知走 SignalR。
builder.Services.AddSingleton<Exam.Application.Common.Interfaces.IExamNotifier, ExamHubNotifier>();

IServiceProvider? rootProvider = null;
var signalR = builder.Services.AddSignalR();

// 多实例部署时靠 Redis Backplane 广播，客户端不必连到同一台机器。
// 导出契约时不连 Redis：背板会在启动时就去连，连不上只会刷一屏错误日志。
if (exportOpenApiPath is null)
{
    signalR.AddStackExchangeRedis(options =>
    {
        options.Configuration.ChannelPrefix = StackExchange.Redis.RedisChannel.Literal("exam-signalr");
        options.ConnectionFactory = _ =>
        {
            var multiplexer = rootProvider!.GetRequiredService<StackExchange.Redis.IConnectionMultiplexer>();
            return Task.FromResult(multiplexer);
        };
    });
}

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
                var issuedAtMs = context.Principal?.FindFirst("iat_ms")?.Value;
                var issuedAtSeconds = context.Principal?.FindFirst(JwtRegisteredClaimNames.Iat)?.Value;

                DateTimeOffset? issuedAtUtc = null;
                if (long.TryParse(issuedAtMs, out var issuedAtUnixMs))
                {
                    issuedAtUtc = DateTimeOffset.FromUnixTimeMilliseconds(issuedAtUnixMs);
                }
                else if (long.TryParse(issuedAtSeconds, out var issuedAtUnixSeconds))
                {
                    issuedAtUtc = DateTimeOffset.FromUnixTimeSeconds(issuedAtUnixSeconds);
                }

                if (long.TryParse(subject, out var userId) && issuedAtUtc is { } issuedAt)
                {
                    if (await blacklist.IsUserRevokedAsync(userId, issuedAt, context.HttpContext.RequestAborted))
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
// 限流分档：登录按 IP + 按账号，写端点与读端点按用户。
// 档位与阈值见 docs/design/05-api.md §1.5，实现见 Exam.Web/RateLimiting。
builder.Services.AddRateLimiter(ExamRateLimiter.Configure);

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

// ---------------------------------------------------------------- API 契约
// 控制器上的 XML 注释即接口说明：注释写清楚，契约就清楚，
// 前端拿到的 OpenAPI 与文档里写的不会两套说法。
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "知行测评 · 考试平台 API",
        Version = "v1",
        Description = "考试、练习、组卷、阅卷与运维接口的统一契约。"
            + "鉴权用登录接口返回的 access_token（Bearer）。"
            + "错误统一为 ProblemDetails，错误码见 docs/api/README.md。",
    });

    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "填入登录接口返回的 access_token。",
    });

    options.AddSecurityRequirement(document => new OpenApiSecurityRequirement
    {
        [new OpenApiSecuritySchemeReference("Bearer", document, null!)] = new List<string>(),
    });

    // 接口要求的权限码进契约：前端与端到端测试都据此判断「能不能调」。
    options.OperationFilter<Exam.Web.Api.RequiredPermissionFilter>();

    var xmlPath = Path.Combine(AppContext.BaseDirectory, "Exam.Web.xml");

    if (File.Exists(xmlPath))
    {
        options.IncludeXmlComments(xmlPath);
    }
});

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
// 只信任**明确的**反向代理网段。X-Forwarded-For 是客户端可控的头，
// 不限定信任范围就等于让任何人都能伪造来源 IP——审计记的 IP 与限流的分区键都靠它。
//
// 限流按客户端的**局域网地址**分桶（一台机器一个桶），前提是这个地址不可伪造：
// 考场局域网里的机器直连 API 端口时，它自带的 X-Forwarded-For 必须被忽略，
// 用的只能是连接本身的来源地址。
var forwardedHeaders = new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
    // 只认紧挨着的那一跳：X-Forwarded-For 最右边一项由代理写入，是客户端地址。
    ForwardLimit = 1,
};

var trustedNetworks = TrustedProxyNetworks();
foreach (var network in trustedNetworks)
{
    forwardedHeaders.KnownIPNetworks.Add(network);
}

app.Logger.LogInformation(
    "受信任的反向代理网段：{Networks}；未列入的来源地址一律按直连处理，"
    + "来源 IP 取连接本身的地址（限流按客户端局域网地址分桶）。",
    trustedNetworks.Count == 0
        ? "（无，只认回环）"
        : string.Join(", ", trustedNetworks.Select(n => n.ToString())));

app.UseForwardedHeaders(forwardedHeaders);
app.UseCors();
// API 契约：不需要鉴权，前端与第三方按文档对接。
app.UseSwagger();

// 认证要先于限流：写端点按用户分区，拿到用户标识才分得开。
app.UseAuthentication();

// 登录端点还要按账号限流，账号名在请求体里：限流之前先把账号取出来。
app.UseMiddleware<LoginAccountMiddleware>();
app.UseRateLimiter();

app.UseAuthorization();

app.MapControllers();
app.MapHub<ProctoringHub>("/hubs/proctoring");
app.MapHub<ExamHub>("/hubs/exam");

app.MapHealthChecks("/health/live", new HealthCheckOptions { Predicate = _ => false });
app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = c => c.Tags.Contains("ready") });
app.MapHealthChecks("/health/startup", new HealthCheckOptions { Predicate = _ => false });

app.MapMetrics();

// 受信任的反向代理网段。
//
// 三种写法都认（逗号分隔或逐项）：
//   ForwardedHeaders:KnownNetworks: ["10.0.0.0/8"]        （appsettings 数组）
//   ForwardedHeaders__KnownNetworks=10.0.0.0/8,10.1.0.0/16 （环境变量标量）
//   ForwardedHeaders__KnownNetworks__0=10.0.0.0/8            （环境变量逐项）
//
// 没配就按**容器自身网段**兜底：跑在 compose 里时，nginx 与 API 之间的那段
// 网桥就是容器网络——局域网里的机器地址不在其中，它们自带的
// X-Forwarded-For 因此不会被采信。显式配了就以配置的为准。
IList<System.Net.IPNetwork> TrustedProxyNetworks()
{
    var networks = new List<System.Net.IPNetwork>();

    foreach (var item in ConfiguredProxyNetworks())
    {
        if (System.Net.IPNetwork.TryParse(item, out var network))
        {
            networks.Add(network);
        }
        else
        {
            app.Logger.LogWarning("忽略解析不了的受信任代理网段：{Value}", item);
        }
    }

    if (networks.Count > 0)
    {
        return networks;
    }

    if (ClientAddress.IsContainer())
    {
        foreach (var network in ClientAddress.LocalNetworks())
        {
            app.Logger.LogInformation("未配置受信任代理网段，按容器自身网段兜底：{Network}", network);
            networks.Add(network);
        }
    }

    return networks;
}

// 配置里的受信任代理网段。数组、标量、逐项环境变量三种写法都收进来。
List<string> ConfiguredProxyNetworks()
{
    var section = app.Configuration.GetSection("ForwardedHeaders:KnownNetworks");
    var items = new List<string>();

    // 逐项写法（KnownNetworks__0 / __1）：子节点优先。
    var children = section.GetChildren().ToList();
    if (children.Count > 0)
    {
        items.AddRange(children.Select(c => c.Value ?? string.Empty));
    }
    else if (section.Value is { Length: > 0 } scalar)
    {
        items.AddRange(scalar.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
    }

    return items.Where(i => !string.IsNullOrWhiteSpace(i)).ToList();
}

// 业务指标要先建好：即使还没发生过保存答案，/metrics 也要把指标名列出来，
// 告警表达式才不会因为「指标不存在」而失效。
_ = app.Services.GetRequiredService<IExamMetrics>();

// OpenAPI 导出：起一次应用，取服务自己吐出来的那份契约落盘。
if (exportOpenApiPath is not null)
{
    await ExportOpenApiAsync(app, exportOpenApiPath);

    return;
}

app.Run();

// 导出 OpenAPI 契约文件。
// 取的是运行中的应用经 Swagger 中间件吐出来的那份 JSON，
// 与 Swagger UI 看到的完全一致——不会出现「文档里是一套、导出的是另一套」。
static async Task ExportOpenApiAsync(WebApplication app, string outputPath)
{
    await app.StartAsync();

    try
    {
        var addresses = app.Services.GetRequiredService<IServer>()
            .Features.Get<IServerAddressesFeature>()?
            .Addresses;

        var baseAddress = addresses?.FirstOrDefault()
            ?? "http://127.0.0.1:5199";

        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        var json = await http.GetStringAsync($"{baseAddress.TrimEnd('/')}/swagger/v1/swagger.json");

        var fullPath = Path.GetFullPath(outputPath);
        var directory = Path.GetDirectoryName(fullPath);

        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        await File.WriteAllTextAsync(fullPath, json);

        Console.WriteLine($"OpenAPI 契约已导出：{fullPath}（{json.Length} 字节）");
    }
    finally
    {
        await app.StopAsync();
    }
}

/// <summary>供 WebApplicationFactory 使用的入口标记。</summary>
public partial class Program;

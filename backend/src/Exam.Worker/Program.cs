using Exam.Infrastructure;
using Exam.Application.Common.Interfaces;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Exam.Infrastructure.Observability;
using Exam.Infrastructure.Seeding;
using Exam.Worker;
using Exam.Worker.Observability;
using Microsoft.Extensions.DependencyInjection;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using Prometheus;
using Serilog;

var builder = Host.CreateApplicationBuilder(args);

Log.Logger = new LoggerConfiguration()
    .ReadFrom.Configuration(builder.Configuration)
    .Enrich.FromLogContext()
    .Enrich.WithProperty("Application", "exam-worker")
    .WriteTo.Console(new Serilog.Formatting.Compact.CompactJsonFormatter())
    .CreateLogger();

builder.Logging.ClearProviders();
builder.Logging.AddSerilog(Log.Logger, dispose: true);

builder.Services.AddExamInfrastructure(builder.Configuration);

// Worker 侧的指标只在 Worker 进程采集：作业耗时、Outbox 积压、对账差异、
// 活跃会话与数据库连接水位。API 侧的指标在 API 进程，两边不混。
builder.Services.AddSingleton<IWorkerMetrics>(_ => new WorkerMetrics(Metrics.DefaultFactory));

// 后台进程的调用者：Worker 没有 HTTP 上下文，审计里不记操作人。
// 不注册它的话，审计拦截器解析不出来，Worker 连数据库上下文都构造不出来。
builder.Services.AddSingleton<ICurrentUser, BackgroundCurrentUser>();

// 后台进程没有 HTTP 请求：审计里的客户端 IP 与 User-Agent 留空。
builder.Services.AddSingleton<IRequestContext, BackgroundRequestContext>();

// 后台作业的指标也要能被采集：作业耗时、Outbox 积压、对账差异。
builder.Services.AddOpenTelemetry()
    .ConfigureResource(resource => resource.AddService("exam-worker"))
    .WithMetrics(metrics => metrics
        .AddOtlpExporter());
builder.Services.AddHostedService<WorkerHeartbeatService>();
builder.Services.AddHostedService<OutboxDispatchService>();
builder.Services.AddHostedService<StatisticsRecalculationService>();
builder.Services.AddHostedService<AnswerReconciliationJob>();
builder.Services.AddHostedService<MetricsEndpointService>();
builder.Services.AddHostedService<ActiveSessionSampler>();
builder.Services.AddHostedService<DatabaseConnectionSampler>();

var host = builder.Build();

// 指标要先建好：指标端口一开就能列出全部指标名，
// 告警表达式不会因为「指标不存在」而失效。
_ = host.Services.GetRequiredService<IWorkerMetrics>();

// 迁移模式：应用数据库迁移后退出。
// 不使用 `dotnet ef` CLI：EF Design 包只在生成迁移时需要，运行时直接调用
// DbContext.Database.Migrate() 即可，避免镜像里塞 SDK 与工具链。
if (args.Contains("--migrate", StringComparer.OrdinalIgnoreCase))
{
    using var scope = host.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<Exam.Infrastructure.Persistence.AppDbContext>();
    await db.Database.MigrateAsync();
    Log.Information("数据库迁移已应用。");
    return;
}

// 种子模式：dotnet run --project src/Exam.Worker -- --seed
if (args.Contains("--seed", StringComparer.OrdinalIgnoreCase))
{
    using var scope = host.Services.CreateScope();
    var seeder = scope.ServiceProvider.GetRequiredService<DataSeeder>();
    var adminUsername = builder.Configuration["Seed:AdminUsername"] ?? "admin";
    var adminPassword = builder.Configuration["Seed:AdminPassword"];

    var outcome = await seeder.SeedAsync(adminUsername, adminPassword);
    Console.WriteLine(outcome == SeedOutcome.Seeded ? "种子数据写入完成。" : "种子数据已存在，跳过。");
    return;
}

await host.RunAsync();

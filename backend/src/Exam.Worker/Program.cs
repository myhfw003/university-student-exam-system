using Exam.Infrastructure;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Exam.Infrastructure.Seeding;
using Exam.Worker;
using Microsoft.Extensions.DependencyInjection;
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
builder.Services.AddHostedService<WorkerHeartbeatService>();
builder.Services.AddHostedService<OutboxDispatchService>();
builder.Services.AddHostedService<StatisticsRecalculationService>();
builder.Services.AddHostedService<AnswerReconciliationJob>();

var host = builder.Build();

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

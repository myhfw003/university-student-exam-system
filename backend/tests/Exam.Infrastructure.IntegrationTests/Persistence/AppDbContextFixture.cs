using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Testcontainers.PostgreSql;

namespace Exam.Infrastructure.IntegrationTests.Persistence;

/// <summary>
/// 集成测试夹具：真实 PostgreSQL 17 容器。
/// 不用 SQLite——jsonb、递归 CTE、部分索引、xmin 并发令牌等特性无法等价。
/// </summary>
public sealed class AppDbContextFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    public AppDbContext DbContext { get; private set; } = null!;

    /// <summary>同一连接串的 DbContext 选项，用于构造并发的第二个上下文。</summary>
    public DbContextOptions<AppDbContext> Options { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        await _postgres.StartAsync();

        Options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(_postgres.GetConnectionString())
            .UseSnakeCaseNamingConvention()
            .Options;

        DbContext = new AppDbContext(Options);
        await DbContext.Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        await DbContext.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    /// <summary>为每个用例清空业务表（保留迁移历史与结构）。</summary>
    public async Task ResetAsync()
    {
        // 清空变更跟踪器：TRUNCATE RESTART IDENTITY 会把主键计数归零，
        // 若不清理，跟踪中的旧实体与新实体会撞主键。
        DbContext.ChangeTracker.Clear();

        await DbContext.Database.ExecuteSqlRawAsync("""
            TRUNCATE iam.user_role, iam.role_permission, iam.refresh_token,
                     iam.user, iam.role, iam.permission, iam.seed_markers RESTART IDENTITY CASCADE
            """);
    }
}

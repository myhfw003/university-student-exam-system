using Exam.Domain.Identity;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Shouldly;

namespace Exam.Infrastructure.IntegrationTests.Persistence;

public sealed class AppDbContextTests : IClassFixture<AppDbContextFixture>
{
    private readonly AppDbContextFixture _fixture;

    public AppDbContextTests(AppDbContextFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task 迁移在空库上一次跑通()
    {
        // 夹具初始化时已执行 MigrateAsync；这里确认表确实建出来了。
        var tables = await _fixture.DbContext.Database
            .SqlQueryRaw<string>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'iam'")
            .ToListAsync();

        tables.ShouldContain("user");
        tables.ShouldContain("role");
        tables.ShouldContain("permission");
        tables.ShouldContain("refresh_token");
    }

    [Fact]
    public async Task 列名使用蛇形命名()
    {
        var columns = await _fixture.DbContext.Database
            .SqlQueryRaw<string>("""
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = 'iam' AND table_name = 'user'
                """)
            .ToListAsync();

        columns.ShouldContain("username");
        columns.ShouldContain("password_hash");
        columns.ShouldContain("must_change_password");
    }

    [Fact]
    public async Task 全局软删除过滤器_已删除行默认查不到()
    {
        await _fixture.ResetAsync();

        var user = User.Register("softdel01", "软删除用户", "hash", DateTimeOffset.UtcNow);
        await _fixture.DbContext.Users.AddAsync(user);
        await _fixture.DbContext.SaveChangesAsync();

        user.SoftDelete(DateTimeOffset.UtcNow, null);
        await _fixture.DbContext.SaveChangesAsync();

        (await _fixture.DbContext.Users.FirstOrDefaultAsync(u => u.Username == "softdel01"))
            .ShouldBeNull("软删除的行不应被默认查询命中");

        (await _fixture.DbContext.Users.IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.Username == "softdel01"))
            .ShouldNotBeNull("IgnoreQueryFilters 应能取回已删除行");

        await _fixture.ResetAsync();
    }

    [Fact]
    public async Task 乐观并发_并发更新同一行时后者冲突()
    {
        await _fixture.ResetAsync();

        var user = User.Register("concur001", "并发用户", "hash", DateTimeOffset.UtcNow);
        await _fixture.DbContext.Users.AddAsync(user);
        await _fixture.DbContext.SaveChangesAsync();

        var id = user.Id;

        // 两个独立上下文各自加载同一行
        await using var ctx1 = new AppDbContext(_fixture.Options);
        await using var ctx2 = new AppDbContext(_fixture.Options);

        var u1 = await ctx1.Users.FirstAsync(u => u.Id == id);
        var u2 = await ctx2.Users.FirstAsync(u => u.Id == id);

        u1.ChangeDisplayName("第一个修改", DateTimeOffset.UtcNow);
        await ctx1.SaveChangesAsync();

        u2.ChangeDisplayName("第二个修改", DateTimeOffset.UtcNow);
        var act = async () => await ctx2.SaveChangesAsync();

        await act.ShouldThrowAsync<DbUpdateConcurrencyException>();

        await _fixture.ResetAsync();
    }

    [Fact]
    public async Task 账号唯一性_数据库层面拒绝重复()
    {
        await _fixture.ResetAsync();

        var first = User.Register("dupuser01", "重复用户", "hash", DateTimeOffset.UtcNow);
        await _fixture.DbContext.Users.AddAsync(first);
        await _fixture.DbContext.SaveChangesAsync();

        var second = User.Register("dupuser01", "另一个用户", "hash", DateTimeOffset.UtcNow);
        await _fixture.DbContext.Users.AddAsync(second);

        var act = async () => await _fixture.DbContext.SaveChangesAsync();
        await act.ShouldThrowAsync<DbUpdateException>();

        await _fixture.ResetAsync();
    }

    [Fact]
    public async Task 账号格式由数据库约束兜底()
    {
        await _fixture.ResetAsync();

        // 绕过领域层直接写入非法账号（长度不足），验证 CHECK 约束在数据库层生效
        var act = async () => await _fixture.DbContext.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO iam.user (username, display_name, password_hash, status, must_change_password,
                                  failed_login_count, created_at)
            VALUES ('ab', '非法账号', 'hash', 'Active', false, 0, now())
            """);

        var ex = await act.ShouldThrowAsync<PostgresException>();
        ex.SqlState.ShouldBe(PostgresErrorCodes.CheckViolation);

        await _fixture.ResetAsync();
    }
}

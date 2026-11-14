using Exam.Domain.Identity;
using Exam.Domain.Identity.Events;
using Exam.Domain.SharedKernel.Events;
using Exam.Infrastructure.Audit;
using Exam.Infrastructure.IntegrationTests.Persistence;
using Exam.Infrastructure.Messaging;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace Exam.Infrastructure.IntegrationTests.Messaging;

/// <summary>
/// 领域事件出站。
/// <para>
/// 领域事件与聚合状态落在同一个事务里：业务回滚，事件也回滚。
/// </para>
/// </summary>
public sealed class OutboxTests : IClassFixture<AppDbContextFixture>
{
    private readonly AppDbContextFixture _fixture;

    public OutboxTests(AppDbContextFixture fixture) => _fixture = fixture;

    private DbContextOptions<AppDbContext> BuildOptions(bool withAuditInterceptor = false)
    {
        var builder = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(_fixture.ConnectionString)
            .UseSnakeCaseNamingConvention();

        builder.AddInterceptors(new OutboxSaveChangesInterceptor());

        if (withAuditInterceptor)
        {
            builder.AddInterceptors(new AuditSaveChangesInterceptor(new StubCurrentUser(), new StubClock()));
        }

        return builder.Options;
    }

    private sealed class StubCurrentUser : Application.Common.Interfaces.ICurrentUser
    {
        public bool IsAuthenticated => true;
        public long? UserId => 1;
        public string? Username => "tester";
        public string? DisplayName => "测试";
        public IReadOnlySet<string> Permissions => new HashSet<string>();
        public bool HasPermission(string permissionCode) => false;
    }

    private sealed class StubClock : Domain.SharedKernel.Abstractions.IClock
    {
        public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
    }

    [Fact]
    public async Task 领域事件随聚合一起落库()
    {
        await _fixture.ResetAsync();

        await using var db = new AppDbContext(BuildOptions());

        var user = User.Register("outboxuser1", "出站箱用户", "hash", DateTimeOffset.UtcNow);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var messages = await db.OutboxMessages.AsNoTracking().ToListAsync();
        messages.Count.ShouldBe(1);
        messages[0].MessageType.ShouldBe(typeof(UserRegistered).FullName);
        messages[0].Payload.ShouldContain("outboxuser1");
        messages[0].DispatchedAt.ShouldBeNull();
        messages[0].Attempts.ShouldBe(0);
    }

    [Fact]
    public async Task 事件不会重复落库()
    {
        await _fixture.ResetAsync();

        await using var db = new AppDbContext(BuildOptions());

        var user = User.Register("outboxuser2", "出站箱用户", "hash", DateTimeOffset.UtcNow);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        // 再保存一次：事件已经写过了，不该再来一条。
        user.ChangeDisplayName("新名字", DateTimeOffset.UtcNow);
        db.Users.Update(user);
        await db.SaveChangesAsync();

        var messages = await db.OutboxMessages.AsNoTracking().ToListAsync();
        messages.Count.ShouldBe(1);
    }

    [Fact]
    public async Task 两个拦截器同时在场事件照样落库()
    {
        await _fixture.ResetAsync();

        await using var db = new AppDbContext(BuildOptions(withAuditInterceptor: true));

        var user = User.Register("outboxuser4", "出站箱用户", "hash", DateTimeOffset.UtcNow);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var messages = await db.OutboxMessages.AsNoTracking().ToListAsync();
        messages.Count.ShouldBe(1);
    }

    [Fact]
    public async Task 业务回滚事件也回滚()
    {
        await _fixture.ResetAsync();

        await using var db = new AppDbContext(BuildOptions());

        var user = User.Register("outboxuser3", "出站箱用户", "hash", DateTimeOffset.UtcNow);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        // 再造一个违反唯一约束的用户：业务回滚，事件也不该留下。
        var duplicate = User.Register("outboxuser3", "出站箱用户", "hash", DateTimeOffset.UtcNow);
        db.Users.Add(duplicate);

        await Should.ThrowAsync<DbUpdateException>(() => db.SaveChangesAsync());

        var messages = await db.OutboxMessages.AsNoTracking().ToListAsync();
        messages.Count.ShouldBe(1);
    }
}

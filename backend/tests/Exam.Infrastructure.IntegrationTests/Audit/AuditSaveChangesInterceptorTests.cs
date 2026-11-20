using Exam.Application.Common.Interfaces;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Infrastructure.Audit;
using Exam.Infrastructure.Persistence;
using Exam.Infrastructure.IntegrationTests.Persistence;
using Microsoft.EntityFrameworkCore;
using NSubstitute;
using Shouldly;

namespace Exam.Infrastructure.IntegrationTests.Audit;

/// <summary>
/// 实体字段变更的自动留痕。审计记录必须与业务变更同事务落库。
/// </summary>
public sealed class AuditSaveChangesInterceptorTests : IClassFixture<AppDbContextFixture>
{
    private readonly AppDbContextFixture _fixture;

    public AuditSaveChangesInterceptorTests(AppDbContextFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task 修改用户_自动留下字段级审计()
    {
        await _fixture.ResetAsync();

        var currentUser = Substitute.For<ICurrentUser>();
        currentUser.UserId.Returns(42L);
        currentUser.Username.Returns("admin");

        var interceptor = new AuditSaveChangesInterceptor(currentUser, new FixedClock());

        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(_fixture.ConnectionString)
            .UseSnakeCaseNamingConvention()
            .AddInterceptors(interceptor)
            .Options;

        await using var db = new AppDbContext(options);

        var user = User.Register("audituser01", "审计用户", "hash", DateTimeOffset.UtcNow);
        await db.Users.AddAsync(user);
        await db.SaveChangesAsync();

        user.ChangeDisplayName("改名了", DateTimeOffset.UtcNow);
        await db.SaveChangesAsync();

        var logs = await db.Set<Domain.Audit.AuditLog>()
            .Where(x => x.TargetType == "user" && x.TargetId == user.Id.ToString())
            .ToListAsync();

        logs.ShouldNotBeEmpty("修改用户应自动留下审计记录。");
        logs[0].Action.ShouldBe("entity.user.updated");
        logs[0].Summary.ShouldContain("DisplayName");
        // 变更前后摘要：旧值与新值都在（FR-IAM-07）。
        logs[0].Summary.ShouldContain("审计用户");
        logs[0].Summary.ShouldContain("改名了");
        logs[0].OperatorId.ShouldBe(42L);
        logs[0].OperatorName.ShouldBe("admin");

        await _fixture.ResetAsync();
    }

    [Fact]
    public async Task 改密码_审计里不留密码哈希()
    {
        await _fixture.ResetAsync();

        var currentUser = Substitute.For<ICurrentUser>();
        currentUser.UserId.Returns(42L);
        currentUser.Username.Returns("admin");

        var interceptor = new AuditSaveChangesInterceptor(currentUser, new FixedClock());

        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(_fixture.ConnectionString)
            .UseSnakeCaseNamingConvention()
            .AddInterceptors(interceptor)
            .Options;

        await using var db = new AppDbContext(options);

        var user = User.Register("pwuser001", "密码用户", "old-hash", DateTimeOffset.UtcNow);
        await db.Users.AddAsync(user);
        await db.SaveChangesAsync();

        // 需要重新计算哈希，才算「密码哈希变了」。
        var verifier = Substitute.For<IPasswordVerifier>();
        verifier.Verify(Arg.Any<string>(), Arg.Any<string>())
            .Returns(PasswordVerificationResult.SuccessRehashNeeded);
        verifier.Hash(Arg.Any<string>()).Returns("new-hash");

        user.ChangePassword("old-hash", "NewPass123", verifier, DateTimeOffset.UtcNow);
        await db.SaveChangesAsync();

        var logs = await db.Set<Domain.Audit.AuditLog>()
            .Where(x => x.TargetType == "user" && x.TargetId == user.Id.ToString())
            .ToListAsync();

        logs.ShouldNotBeEmpty();
        // 字段名留着，值全掩码——密码不进日志（FR-AUD-02）。
        logs[0].Summary.ShouldContain("PasswordHash");
        logs[0].Summary.ShouldNotContain("old-hash");
        logs[0].Summary.ShouldNotContain("new-hash");

        await _fixture.ResetAsync();
    }

    private sealed class FixedClock : IClock
    {
        public DateTimeOffset UtcNow { get; } = new(2026, 11, 14, 4, 0, 0, TimeSpan.Zero);
    }
}

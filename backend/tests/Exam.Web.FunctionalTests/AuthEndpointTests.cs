using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Testcontainers.PostgreSql;
using Xunit;

namespace Exam.Web.FunctionalTests;

/// <summary>
/// 认证端点的端到端测试：真实 PostgreSQL 17 容器 + 真实 HTTP 管线 + 真实鉴权。
/// </summary>
public sealed class AuthEndpointTests : IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        await _postgres.StartAsync();

        _factory = new ExamWebFactory(_postgres.GetConnectionString());
        _client = _factory.CreateClient();
        _client.BaseAddress = new Uri("http://localhost");

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 未认证访问_me_返回401()
    {
        var response = await _client.GetAsync("/api/v1/auth/me");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task 登录_账号不存在_返回统一提示()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/v1/auth/login",
            new { username = "nobody-here", password = "whatever" });

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);

        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(20005, problem.GetProperty("errorCode").GetInt32());
        Assert.Equal("账号或密码错误。", problem.GetProperty("title").GetString());
    }

    [Fact]
    public async Task 登录_参数缺失_返回400()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/v1/auth/login",
            new { username = "", password = "" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task 系统时间_返回服务端UTC时间()
    {
        var response = await _client.GetAsync("/api/v1/system/time");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var serverTime = body.GetProperty("serverTime").GetDateTimeOffset();
        Assert.True(
            Math.Abs((DateTimeOffset.UtcNow - serverTime).TotalSeconds) < 10,
            "服务端时间应与本机时间接近。");
    }

    [Fact]
    public async Task 健康检查_live_返回Healthy()
    {
        var response = await _client.GetAsync("/health/live");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Healthy", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task 全局软删除_已删除用户查不到()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Users.Add(Domain.Identity.User.Register(
            "tempuser01", "临时用户", "hash:xxx", DateTimeOffset.UtcNow));
        await db.SaveChangesAsync();

        var created = await db.Users.FirstAsync(u => u.Username == "tempuser01");
        created.SoftDelete(DateTimeOffset.UtcNow, null);
        await db.SaveChangesAsync();

        Assert.Null(await db.Users.FirstOrDefaultAsync(u => u.Username == "tempuser01"));

        // IgnoreQueryFilters 可以取回已删除行
        Assert.NotNull(await db.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.Username == "tempuser01"));
    }
}

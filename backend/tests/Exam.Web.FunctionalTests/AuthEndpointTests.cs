using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Exam.Domain.Audit;
using Exam.Domain.SharedKernel.Abstractions;
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

    [Fact]
    public async Task 修改密码_原密码错误_返回422()
    {
        const string username = "e2epassword1";
        await CreateUserAsync(username, "OldPass123");
        var token = await LoginAsync(username, "OldPass123");

        var response = await ChangePasswordAsync(token, "WrongPass123", "NewPass456");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    [Fact]
    public async Task 修改密码_成功后旧密码失效_新密码可登录()
    {
        const string username = "e2epassword2";
        await CreateUserAsync(username, "OldPass123");
        var token = await LoginAsync(username, "OldPass123");

        var response = await ChangePasswordAsync(token, "OldPass123", "NewPass456");

        // 改密后返回新的访问令牌：旧令牌带着「必须改密」的标记，不换掉就还用不了。
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(string.IsNullOrWhiteSpace(body.GetProperty("accessToken").GetString()));

        var oldLogin = await _client.PostAsJsonAsync(
            "/api/v1/auth/login", new { username, password = "OldPass123" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, oldLogin.StatusCode);

        var newLogin = await _client.PostAsJsonAsync(
            "/api/v1/auth/login", new { username, password = "NewPass456" });
        Assert.Equal(HttpStatusCode.OK, newLogin.StatusCode);
    }

    [Fact]
    public async Task 管理员重置密码_旧令牌立即失效_新登录的令牌立刻可用()
    {
        const string username = "resetpwd01";
        await CreateUserAsync(username, "OldPass123");
        var oldToken = await LoginAsync(username, "OldPass123");

        // 旧令牌先能用。
        var before = await GetMeAsync(oldToken);
        Assert.Equal(HttpStatusCode.OK, before.StatusCode);

        // 管理员重置密码（后端一律置「必须改密」）。
        var adminToken = await LoginAsAdminAsync();
        var userId = await GetUserIdAsync(username);
        var reset = await PostAsAdminAsync(
            adminToken,
            $"/api/v1/users/{userId}/reset-password",
            new { newPassword = "NewPass123", mustChangeOnNextLogin = true });
        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);

        // 旧令牌立即失效。
        var revoked = await GetMeAsync(oldToken);
        Assert.Equal(HttpStatusCode.Unauthorized, revoked.StatusCode);

        // 新密码登录拿到的令牌立刻可用：
        // 令牌里的签发时间只到秒，若按整秒判定「重置前的令牌」，
        // 同一秒内登录会被误判成旧令牌（401）。
        var newToken = await LoginAsync(username, "NewPass123");
        var me = await GetMeAsync(newToken);
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);

        var body = await me.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.GetProperty("mustChangePassword").GetBoolean());
    }

    [Fact]
    public async Task 登录成功_写审计日志()
    {
        const string username = "auditlogin1";
        await CreateUserAsync(username, "Pass123456");
        var userId = await GetUserIdAsync(username);

        await LoginAsync(username, "Pass123456");

        var row = (await GetAuditLogsAsync("auth.login"))
            .LastOrDefault(l => l.OperatorName == username);

        Assert.NotNull(row);
        Assert.Equal(userId, row!.OperatorId);
        Assert.Equal("user", row.TargetType);
        Assert.Equal(userId.ToString(), row.TargetId);
        Assert.Contains(username, row.Summary);
    }

    [Fact]
    public async Task 登录失败_写审计日志并落库()
    {
        const string username = "auditfail01";
        await CreateUserAsync(username, "Pass123456");

        var response = await _client.PostAsJsonAsync(
            "/api/v1/auth/login", new { username, password = "WrongPass1" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);

        var row = (await GetAuditLogsAsync("auth.login_failed"))
            .LastOrDefault(l => l.OperatorName == username);

        Assert.NotNull(row);
        Assert.Contains("密码错误", row!.Summary);

        // 失败路径必须自己落库：跟着异常回滚的话失败计数归零，账号永远锁不住。
        var state = await GetUserLoginStateAsync(username);
        Assert.Equal(1, state.FailedLoginCount);
        Assert.Equal(Domain.Identity.UserStatus.Active, state.Status);
    }

    [Fact]
    public async Task 账号不存在_写审计日志()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/v1/auth/login", new { username = "ghost-account", password = "whatever" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);

        var row = (await GetAuditLogsAsync("auth.login_failed"))
            .LastOrDefault(l => l.OperatorName == "ghost-account");

        Assert.NotNull(row);
        Assert.Contains("账号不存在", row!.Summary);
        // 账号不存在就无从知道操作者是谁，账号 ID 留空。
        Assert.Null(row.OperatorId);
    }

    [Fact]
    public async Task 连续五次密码错误_账号被锁定()
    {
        const string username = "auditlock01";
        await CreateUserAsync(username, "Pass123456");

        for (var i = 0; i < 5; i++)
        {
            var response = await _client.PostAsJsonAsync(
                "/api/v1/auth/login", new { username, password = "WrongPass1" });
            Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        }

        var state = await GetUserLoginStateAsync(username);
        Assert.Equal(Domain.Identity.UserStatus.Locked, state.Status);

        // 锁定期内即便密码正确也登不进去。
        var blocked = await _client.PostAsJsonAsync(
            "/api/v1/auth/login", new { username, password = "Pass123456" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, blocked.StatusCode);

        var problem = await blocked.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("账号已被锁定，请稍后再试。", problem.GetProperty("title").GetString());
    }

    private async Task<List<AuditLog>> GetAuditLogsAsync(string action)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.Set<AuditLog>()
            .Where(l => l.Action == action)
            .OrderBy(l => l.OccurredAt)
            .ToListAsync();
    }

    private async Task<(int FailedLoginCount, Domain.Identity.UserStatus Status)> GetUserLoginStateAsync(
        string username)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = await db.Users.FirstAsync(u => u.Username == username);
        return (user.FailedLoginCount, user.Status);
    }

    private async Task<HttpResponseMessage> GetMeAsync(string token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/auth/me");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await _client.SendAsync(request);
    }

    private async Task<long> GetUserIdAsync(string username)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = await db.Users.FirstAsync(u => u.Username == username);
        return user.Id;
    }

    /// <summary>造一个能改密码的管理员账号。</summary>
    private async Task<string> LoginAsAdminAsync()
    {
        const string username = "resetadmin1";
        const string password = "AdminPass123";

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var verifier = scope.ServiceProvider.GetRequiredService<IPasswordVerifier>();
        var now = DateTimeOffset.UtcNow;

        var user = await db.Users.FirstOrDefaultAsync(u => u.Username == username);
        if (user is null)
        {
            user = Domain.Identity.User.Register(username, "重置密码管理员", verifier.Hash(password), now);
            await db.Users.AddAsync(user);
            await db.SaveChangesAsync();

            var permission = await db.Permissions.FirstOrDefaultAsync(p => p.Code == "user:write");
            if (permission is null)
            {
                permission = Domain.Identity.Permission.Create("user:write", "编辑用户", "user");
                await db.Permissions.AddAsync(permission);
                await db.SaveChangesAsync();
            }

            var role = Domain.Identity.Role.Create("reset_admin_role", "重置密码管理员", now);
            await db.Roles.AddAsync(role);
            await db.SaveChangesAsync();

            await db.RolePermissions.AddAsync(
                Domain.Identity.RolePermission.Create(role.Id, permission.Id, now));
            await db.UserRoles.AddAsync(Domain.Identity.UserRole.Create(user.Id, role.Id, null, now));
            await db.SaveChangesAsync();
        }

        return await LoginAsync(username, password);
    }

    private async Task<HttpResponseMessage> PostAsAdminAsync(string token, string path, object body)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = JsonContent.Create(body),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await _client.SendAsync(request);
    }

    private async Task CreateUserAsync(string username, string password)
    {
        using var scope = _factory.Services.CreateScope();
        var verifier = scope.ServiceProvider.GetRequiredService<IPasswordVerifier>();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        db.Users.Add(Domain.Identity.User.Register(
            username,
            "改密测试用户",
            verifier.Hash(password),
            DateTimeOffset.UtcNow));

        await db.SaveChangesAsync();
    }

    private async Task<string> LoginAsync(string username, string password)
    {
        var response = await _client.PostAsJsonAsync(
            "/api/v1/auth/login", new { username, password });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("accessToken").GetString()!;
    }

    private Task<HttpResponseMessage> ChangePasswordAsync(
        string token,
        string currentPassword,
        string newPassword)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/change-password")
        {
            Content = JsonContent.Create(new { currentPassword, newPassword }),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        return _client.SendAsync(request);
    }
}

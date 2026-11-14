using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Exam.Domain.Identity;
using Exam.Infrastructure.Identity;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;
using Xunit;
using Testcontainers.PostgreSql;

namespace Exam.Web.FunctionalTests;

/// <summary>
/// 用户与角色管理的端到端测试。
/// 重点验证两条验收标准：角色变更下一次请求即生效；禁用用户后其令牌立即失效。
/// </summary>
public sealed class UserManagementEndpointTests : IAsyncLifetime
{
    private const string AdminUsername = "sysadmin001";
    private const string AdminPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _adminRoleId;
    private long _readerRoleId;
    private long _adminUserId;

    public async Task InitializeAsync()
    {
        await _postgres.StartAsync();

        _factory = new ExamWebFactory(_postgres.GetConnectionString());
        _client = _factory.CreateClient();
        _client.BaseAddress = new Uri("http://localhost");

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.MigrateAsync();

        var now = DateTimeOffset.UtcNow;
        _adminRoleId = await SeedRoleAsync(db, "admin_role", "管理员", [
            PermissionCatalog.UserRead, PermissionCatalog.UserWrite,
            PermissionCatalog.RoleRead, PermissionCatalog.RoleWrite]);
        _readerRoleId = await SeedRoleAsync(db, "reader_role", "只读", [PermissionCatalog.UserRead]);

        _adminUserId = await SeedUserAsync(db, AdminUsername, AdminPassword, "系统管理员", _adminRoleId);
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 新建用户_可以立即登录()
    {
        var adminToken = await LoginAsync(AdminUsername, AdminPassword);
        UseToken(adminToken);

        var create = await _client.PostAsJsonAsync(
            "/api/v1/users",
            new { username = "student001", displayName = "林知远", password = "Passw0rd!", roleIds = Array.Empty<long>() });

        var createBody = await create.Content.ReadAsStringAsync();
        if (create.StatusCode != HttpStatusCode.OK)
        {
            Assert.Fail($"status={create.StatusCode} body={createBody}");
        }

        var body = await create.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("user").GetProperty("username").GetString().ShouldBe("student001");

        var studentToken = await LoginAsync("student001", "Passw0rd!");
        studentToken.ShouldNotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task 新建用户_账号重复时返回422()
    {
        var adminToken = await LoginAsync(AdminUsername, AdminPassword);
        UseToken(adminToken);

        await _client.PostAsJsonAsync(
            "/api/v1/users",
            new { username = "dupuser001", displayName = "重复账号", password = "Passw0rd!" });

        var second = await _client.PostAsJsonAsync(
            "/api/v1/users",
            new { username = "dupuser001", displayName = "重复账号", password = "Passw0rd!" });

        second.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);

        var problem = await second.Content.ReadFromJsonAsync<JsonElement>();
        problem.GetProperty("errorCode").GetInt32().ShouldBe(22001);
    }

    [Fact]
    public async Task 用户列表_分页与关键词过滤都生效()
    {
        var adminToken = await LoginAsync(AdminUsername, AdminPassword);
        UseToken(adminToken);

        await _client.PostAsJsonAsync(
            "/api/v1/users",
            new { username = "keyword001", displayName = "关键词命中", password = "Passw0rd!" });

        var list = await _client.GetAsync("/api/v1/users?keyword=keyword001&page=1&size=10");
        list.StatusCode.ShouldBe(HttpStatusCode.OK);

        var body = await list.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("total").GetInt32().ShouldBe(1);
        body.GetProperty("items")[0].GetProperty("username").GetString().ShouldBe("keyword001");
        body.GetProperty("page").GetInt32().ShouldBe(1);
    }

    [Fact]
    public async Task 角色变更_下一次请求即生效()
    {
        var adminToken = await LoginAsync(AdminUsername, AdminPassword);
        UseToken(adminToken);

        await _client.PostAsJsonAsync(
            "/api/v1/users",
            new { username = "promote001", displayName = "待授权", password = "Passw0rd!" });

        var users = await _client.GetAsync("/api/v1/users?keyword=promote001");
        var listBody = await users.Content.ReadFromJsonAsync<JsonElement>();
        var userId = listBody.GetProperty("items")[0].GetProperty("id").GetInt64();

        // 新账号还没有读用户权限，访问用户列表应当被拒。
        var studentToken = await LoginAsync("promote001", "Passw0rd!");
        UseToken(studentToken);

        var denied = await _client.GetAsync("/api/v1/users");
        denied.StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        // 授予只读角色——不换令牌、不重新登录。
        UseToken(adminToken);
        var assign = await _client.PutAsJsonAsync(
            $"/api/v1/users/{userId}/roles",
            new { roleIds = new[] { _readerRoleId } });
        assign.StatusCode.ShouldBe(HttpStatusCode.OK, await assign.Content.ReadAsStringAsync());

        // 原令牌立刻可用。
        UseToken(studentToken);
        var allowed = await _client.GetAsync("/api/v1/users");
        allowed.StatusCode.ShouldBe(HttpStatusCode.OK, await allowed.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task 禁用用户_其令牌立即失效()
    {
        var adminToken = await LoginAsync(AdminUsername, AdminPassword);
        UseToken(adminToken);

        await _client.PostAsJsonAsync(
            "/api/v1/users",
            new { username = "disable001", displayName = "待禁用", password = "Passw0rd!" });

        var users = await _client.GetAsync("/api/v1/users?keyword=disable001");
        var listBody = await users.Content.ReadFromJsonAsync<JsonElement>();
        var userId = listBody.GetProperty("items")[0].GetProperty("id").GetInt64();

        var targetToken = await LoginAsync("disable001", "Passw0rd!");
        UseToken(targetToken);
        (await _client.GetAsync("/api/v1/auth/me")).StatusCode.ShouldBe(HttpStatusCode.OK);

        UseToken(adminToken);
        var disable = await _client.PutAsJsonAsync(
            $"/api/v1/users/{userId}",
            new { displayName = "待禁用", status = "disabled", disableReason = "测试禁用" });
        disable.StatusCode.ShouldBe(HttpStatusCode.OK, await disable.Content.ReadAsStringAsync());

        UseToken(targetToken);
        var after = await _client.GetAsync("/api/v1/auth/me");
        after.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task 重置密码_旧密码失效且要求改密()
    {
        var adminToken = await LoginAsync(AdminUsername, AdminPassword);
        UseToken(adminToken);

        await _client.PostAsJsonAsync(
            "/api/v1/users",
            new { username = "reset001", displayName = "待重置", password = "Passw0rd!" });

        var users = await _client.GetAsync("/api/v1/users?keyword=reset001");
        var listBody = await users.Content.ReadFromJsonAsync<JsonElement>();
        var userId = listBody.GetProperty("items")[0].GetProperty("id").GetInt64();

        var reset = await _client.PostAsJsonAsync(
            $"/api/v1/users/{userId}/reset-password",
            new { newPassword = "NewPassw0rd!" });
        reset.StatusCode.ShouldBe(HttpStatusCode.OK);

        var oldLogin = await _client.PostAsJsonAsync(
            "/api/v1/auth/login",
            new { username = "reset001", password = "Passw0rd!" });
        oldLogin.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);

        var newLogin = await _client.PostAsJsonAsync(
            "/api/v1/auth/login",
            new { username = "reset001", password = "NewPassw0rd!" });
        newLogin.StatusCode.ShouldBe(HttpStatusCode.OK);

        var body = await newLogin.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("user").GetProperty("mustChangePassword").GetBoolean().ShouldBeTrue();
    }

    [Fact]
    public async Task 角色列表_包含权限点()
    {
        var adminToken = await LoginAsync(AdminUsername, AdminPassword);
        UseToken(adminToken);

        var response = await _client.GetAsync("/api/v1/roles");
        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        var roles = await response.Content.ReadFromJsonAsync<JsonElement>();
        var adminRole = roles.EnumerateArray().First(r => r.GetProperty("code").GetString() == "admin_role");
        adminRole.GetProperty("permissions").GetArrayLength().ShouldBe(4);
    }

    [Fact]
    public async Task 权限点目录_可读取()
    {
        var adminToken = await LoginAsync(AdminUsername, AdminPassword);
        UseToken(adminToken);

        var response = await _client.GetAsync("/api/v1/permissions");
        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        var permissions = await response.Content.ReadFromJsonAsync<JsonElement>();
        permissions.GetArrayLength().ShouldBeGreaterThan(0);
    }

    private void UseToken(string token) =>
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

    private async Task<string> LoginAsync(string username, string password)
    {
        var response = await _client.PostAsJsonAsync(
            "/api/v1/auth/login",
            new { username, password });

        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("accessToken").GetString()!;
    }

    private static async Task<long> SeedRoleAsync(
        AppDbContext db,
        string code,
        string name,
        IReadOnlyCollection<string> permissionCodes)
    {
        var now = DateTimeOffset.UtcNow;
        var role = Role.Create(code, name, now);
        await db.Roles.AddAsync(role);
        await db.SaveChangesAsync();

        foreach (var permissionCode in permissionCodes)
        {
            var permission = await db.Permissions.FirstOrDefaultAsync(p => p.Code == permissionCode);
            if (permission is null)
            {
                permission = Permission.Create(permissionCode, permissionCode, permissionCode.Split(':')[0]);
                await db.Permissions.AddAsync(permission);
                await db.SaveChangesAsync();
            }

            await db.RolePermissions.AddAsync(RolePermission.Create(role.Id, permission.Id, now));
        }

        await db.SaveChangesAsync();
        return role.Id;
    }

    private static async Task<long> SeedUserAsync(
        AppDbContext db,
        string username,
        string password,
        string displayName,
        long roleId)
    {
        var verifier = new Pbkdf2PasswordVerifier();
        var now = DateTimeOffset.UtcNow;

        var user = User.Register(username, displayName, verifier.Hash(password), now);
        await db.Users.AddAsync(user);
        await db.SaveChangesAsync();

        await db.UserRoles.AddAsync(UserRole.Create(user.Id, roleId, null, now));
        await db.SaveChangesAsync();
        return user.Id;
    }

}

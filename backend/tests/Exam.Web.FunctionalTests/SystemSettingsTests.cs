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
using Testcontainers.PostgreSql;

namespace Exam.Web.FunctionalTests;

/// <summary>
/// 系统级设置。
/// <para>
/// 全局生效的开关：管理员改一次，所有人一起变。
/// 按需求文档 §1 的矩阵，<c>system:configure</c> 只给系统管理员。
/// </para>
/// </summary>
public sealed class SystemSettingsTests : IAsyncLifetime
{
    private const string AdminUsername = "settingsadmin1";
    private const string TeacherUsername = "settingsteacher1";
    private const string StudentUsername = "settingsstudent1";
    private const string Password = "Passw0rd!";

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

        var adminRoleId = await SeedRoleAsync(db, "settings_admin", PermissionCatalog.SystemConfigure);
        await SeedUserAsync(db, AdminUsername, Password, adminRoleId);

        var teacherRoleId = await SeedRoleAsync(db, "settings_teacher", PermissionCatalog.ExamRead);
        await SeedUserAsync(db, TeacherUsername, Password, teacherRoleId);

        var studentRoleId = await SeedRoleAsync(db, "settings_student", PermissionCatalog.AttemptReadOwn);
        await SeedUserAsync(db, StudentUsername, Password, studentRoleId);
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 没配过时读到默认口径()
    {
        await LoginAsync(AdminUsername, Password);

        var response = await _client.GetAsync("/api/v1/settings");
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("mistakeResolutionPolicy").GetString().ShouldBe("remove");
    }

    [Fact]
    public async Task 管理员改完立刻生效()
    {
        await LoginAsync(AdminUsername, Password);

        var update = await _client.PutAsJsonAsync(
            "/api/v1/settings",
            new { mistakeResolutionPolicy = "keep_mastered" });
        update.StatusCode.ShouldBe(HttpStatusCode.OK, await update.Content.ReadAsStringAsync());

        var body = await update.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("mistakeResolutionPolicy").GetString().ShouldBe("keep_mastered");

        // 不用重启：再读一次就是新值。
        var get = await _client.GetAsync("/api/v1/settings");
        var getBody = await get.Content.ReadFromJsonAsync<JsonElement>();
        getBody.GetProperty("mistakeResolutionPolicy").GetString().ShouldBe("keep_mastered");
    }

    [Fact]
    public async Task 没配过原始密码时读得到没配()
    {
        await LoginAsync(AdminUsername, Password);

        var response = await _client.GetAsync("/api/v1/settings");
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("originalPasswordConfigured").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task 设置原始密码_读回来只看得到有没有配()
    {
        await LoginAsync(AdminUsername, Password);

        var set = await _client.PutAsJsonAsync(
            "/api/v1/settings/original-password",
            new { password = "OrigPass123" });
        set.StatusCode.ShouldBe(HttpStatusCode.OK, await set.Content.ReadAsStringAsync());

        var body = await set.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("originalPasswordConfigured").GetBoolean().ShouldBeTrue();

        // 只写不回显：响应里既没有密码字段，也不含明文。
        var raw = await set.Content.ReadAsStringAsync();
        raw.ShouldNotContain("OrigPass123");
        raw.ShouldNotContain("originalPasswordHash");

        var get = await _client.GetAsync("/api/v1/settings");
        var getBody = await get.Content.ReadFromJsonAsync<JsonElement>();
        getBody.GetProperty("originalPasswordConfigured").GetBoolean().ShouldBeTrue();
    }

    [Fact]
    public async Task 清除原始密码_之后读得到没配()
    {
        await LoginAsync(AdminUsername, Password);

        await _client.PutAsJsonAsync(
            "/api/v1/settings/original-password",
            new { password = "OrigPass123" });

        var clear = await _client.DeleteAsync("/api/v1/settings/original-password");
        clear.StatusCode.ShouldBe(HttpStatusCode.OK, await clear.Content.ReadAsStringAsync());

        var body = await clear.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("originalPasswordConfigured").GetBoolean().ShouldBeFalse();

        var get = await _client.GetAsync("/api/v1/settings");
        var getBody = await get.Content.ReadFromJsonAsync<JsonElement>();
        getBody.GetProperty("originalPasswordConfigured").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task 原始密码太弱被挡下()
    {
        await LoginAsync(AdminUsername, Password);

        var set = await _client.PutAsJsonAsync(
            "/api/v1/settings/original-password",
            new { password = "short" });
        set.StatusCode.ShouldBe(HttpStatusCode.BadRequest, await set.Content.ReadAsStringAsync());

        // 挡下之后原值不变。
        var get = await _client.GetAsync("/api/v1/settings");
        var body = await get.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("originalPasswordConfigured").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task 没有权限的人配不了原始密码()
    {
        await LoginAsync(TeacherUsername, Password);

        var set = await _client.PutAsJsonAsync(
            "/api/v1/settings/original-password",
            new { password = "OrigPass123" });
        set.StatusCode.ShouldBe(HttpStatusCode.Forbidden, await set.Content.ReadAsStringAsync());

        var clear = await _client.DeleteAsync("/api/v1/settings/original-password");
        clear.StatusCode.ShouldBe(HttpStatusCode.Forbidden, await clear.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task 没有权限的人读不到也改不了()
    {
        await LoginAsync(TeacherUsername, Password);

        var get = await _client.GetAsync("/api/v1/settings");
        get.StatusCode.ShouldBe(HttpStatusCode.Forbidden, await get.Content.ReadAsStringAsync());

        var update = await _client.PutAsJsonAsync(
            "/api/v1/settings",
            new { mistakeResolutionPolicy = "keep_mastered" });
        update.StatusCode.ShouldBe(HttpStatusCode.Forbidden, await update.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task 未登录读不到()
    {
        _client.DefaultRequestHeaders.Authorization = null;

        var get = await _client.GetAsync("/api/v1/settings");
        get.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task 非法取值被挡下()
    {
        await LoginAsync(AdminUsername, Password);

        var update = await _client.PutAsJsonAsync(
            "/api/v1/settings",
            new { mistakeResolutionPolicy = "乱写" });
        update.StatusCode.ShouldBe(HttpStatusCode.BadRequest, await update.Content.ReadAsStringAsync());

        // 挡下之后原值不变。
        var get = await _client.GetAsync("/api/v1/settings");
        var body = await get.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("mistakeResolutionPolicy").GetString().ShouldBe("remove");
    }

    private async Task LoginAsync(string username, string password)
    {
        var response = await _client.PostAsJsonAsync("/api/v1/auth/login", new { username, password });
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        _client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", body.GetProperty("accessToken").GetString());
    }

    private static async Task<long> SeedRoleAsync(AppDbContext db, string code, params string[] permissions)
    {
        var now = DateTimeOffset.UtcNow;
        var role = Role.Create(code, code, now);
        await db.Roles.AddAsync(role);
        await db.SaveChangesAsync();

        foreach (var permissionCode in permissions)
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

    private static async Task SeedUserAsync(AppDbContext db, string username, string password, long roleId)
    {
        var verifier = new Pbkdf2PasswordVerifier();
        var now = DateTimeOffset.UtcNow;

        var user = User.Register(username, username, verifier.Hash(password), now);
        await db.Users.AddAsync(user);
        await db.SaveChangesAsync();

        await db.UserRoles.AddAsync(UserRole.Create(user.Id, roleId, null, now));
        await db.SaveChangesAsync();
    }
}

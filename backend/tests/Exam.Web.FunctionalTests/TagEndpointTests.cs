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
/// 标签端点的端到端测试：真实 PostgreSQL 17 容器 + 真实 HTTP 管线 + 真实鉴权。
/// </summary>
public sealed class TagEndpointTests : IAsyncLifetime
{
    private const string AdminUsername = "tagadmin01";
    private const string AdminPassword = "Passw0rd!";
    private const string ReaderUsername = "tagreader01";
    private const string ReaderPassword = "Passw0rd!";

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

        await SeedUserAsync(db, AdminUsername, AdminPassword, [PermissionCatalog.TagRead, PermissionCatalog.TagWrite]);
        await SeedUserAsync(db, ReaderUsername, ReaderPassword, [PermissionCatalog.TagRead]);
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 未认证访问标签_返回401()
    {
        var response = await _client.GetAsync("/api/v1/tags");

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task 无标签写权限的用户新建标签_返回403()
    {
        var token = await LoginAsync(ReaderUsername, ReaderPassword);
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await _client.PostAsJsonAsync(
            "/api/v1/tags",
            new { code = "forbidden.math", name = "越权标签", group = "domain" });

        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task 新建标签_成功并可按维度查回()
    {
        var token = await LoginAsync(AdminUsername, AdminPassword);
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var create = await _client.PostAsJsonAsync(
            "/api/v1/tags",
            new { code = "math.limit", name = "极限", group = "domain", sortOrder = 1 });

        create.StatusCode.ShouldBe(HttpStatusCode.OK);

        var created = await create.Content.ReadFromJsonAsync<JsonElement>();
        created.GetProperty("code").GetString().ShouldBe("math.limit");
        created.GetProperty("group").GetString().ShouldBe("domain");
        created.GetProperty("groupLabel").GetString().ShouldBe("领域");
        var id = created.GetProperty("id").GetInt64();

        var list = await _client.GetAsync("/api/v1/tags?group=domain");
        list.StatusCode.ShouldBe(HttpStatusCode.OK);

        var body = await list.Content.ReadFromJsonAsync<JsonElement>();
        var groups = body.GetProperty("groups");
        groups.GetArrayLength().ShouldBe(1);
        groups[0].GetProperty("group").GetString().ShouldBe("domain");
        groups[0].GetProperty("tags")[0].GetProperty("name").GetString().ShouldBe("极限");

        // 子标签挂在父标签下，后代展开要能命中
        var child = await _client.PostAsJsonAsync(
            "/api/v1/tags",
            new { code = "math.limit.one", name = "单侧极限", group = "domain", parentId = id, sortOrder = 2 });
        child.StatusCode.ShouldBe(HttpStatusCode.OK);

        var descendants = await _client.GetAsync($"/api/v1/tags/{id}/descendants");
        descendants.StatusCode.ShouldBe(HttpStatusCode.OK);

        var descendantBody = await descendants.Content.ReadFromJsonAsync<JsonElement>();
        descendantBody.GetProperty("ids").GetArrayLength().ShouldBe(2);
    }

    [Fact]
    public async Task 难度标签缺少等级_返回422并带错误码()
    {
        var token = await LoginAsync(AdminUsername, AdminPassword);
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await _client.PostAsJsonAsync(
            "/api/v1/tags",
            new { code = "difficulty.noLevel", name = "缺等级", group = "difficulty" });

        response.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);

        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        problem.GetProperty("errorCode").GetInt32().ShouldBe(20005);
    }

    [Fact]
    public async Task 删除有子标签的标签_返回422()
    {
        var token = await LoginAsync(AdminUsername, AdminPassword);
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var parent = await _client.PostAsJsonAsync(
            "/api/v1/tags",
            new { code = "org.cs", name = "计算机学院", group = "organization", sortOrder = 0 });
        var parentId = (await parent.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt64();

        var child = await _client.PostAsJsonAsync(
            "/api/v1/tags",
            new { code = "org.cs.major", name = "计算机科学与技术", group = "organization", parentId = parentId, sortOrder = 1 });
        var childBody = await child.Content.ReadAsStringAsync();
        child.StatusCode.ShouldBe(HttpStatusCode.OK, childBody);

        var delete = await _client.DeleteAsync($"/api/v1/tags/{parentId}");
        delete.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);

        var problem = await delete.Content.ReadFromJsonAsync<JsonElement>();
        problem.GetProperty("errorCode").GetInt32().ShouldBe(22101);
    }

    private async Task<string> LoginAsync(string username, string password)
    {
        var response = await _client.PostAsJsonAsync(
            "/api/v1/auth/login",
            new { username, password });

        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("accessToken").GetString()!;
    }

    private static async Task SeedUserAsync(
        AppDbContext db,
        string username,
        string password,
        IReadOnlyCollection<string> permissionCodes)
    {
        var verifier = new Pbkdf2PasswordVerifier();
        var now = DateTimeOffset.UtcNow;

        var user = User.Register(username, username, verifier.Hash(password), now);
        await db.Users.AddAsync(user);
        await db.SaveChangesAsync();

        var role = Role.CreateSystem($"role_{username}", username, now);
        await db.Roles.AddAsync(role);
        await db.SaveChangesAsync();

        foreach (var code in permissionCodes)
        {
            var permission = await db.Permissions.FirstOrDefaultAsync(p => p.Code == code);
            if (permission is null)
            {
                permission = Permission.Create(code, code, code.Split(':')[0]);
                await db.Permissions.AddAsync(permission);
                await db.SaveChangesAsync();
            }

            await db.RolePermissions.AddAsync(RolePermission.Create(role.Id, permission.Id, now));
        }

        await db.UserRoles.AddAsync(UserRole.Create(user.Id, role.Id, null, now));
        await db.SaveChangesAsync();
    }
}

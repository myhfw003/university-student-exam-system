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
            PermissionCatalog.RoleRead, PermissionCatalog.RoleWrite,
            PermissionCatalog.UserTagAssign, PermissionCatalog.UserImport,
            PermissionCatalog.TagRead, PermissionCatalog.TagWrite,
            PermissionCatalog.AuditRead]);
        _readerRoleId = await SeedRoleAsync(db, "reader_role", "只读", [PermissionCatalog.UserRead]);

        // 名单导入会按角色编码查找角色，系统角色必须先在库里。
        await SeedSystemRoleAsync(db, Role.Codes.Student, "在校学生");
        await SeedSystemRoleAsync(db, Role.Codes.GeneralUser, "社会人士");

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
    public async Task 用户接口_手机号按前3后4脱敏()
    {
        var adminToken = await LoginAsync(AdminUsername, AdminPassword);
        UseToken(adminToken);

        await _client.PostAsJsonAsync(
            "/api/v1/users",
            new
            {
                username = "phone001",
                displayName = "手机号脱敏",
                password = "Passw0rd!",
                phone = "13812345678",
            });

        var list = await _client.GetAsync("/api/v1/users?keyword=phone001&page=1&size=10");
        list.StatusCode.ShouldBe(HttpStatusCode.OK);

        var body = await list.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("items")[0].GetProperty("phone").GetString().ShouldBe("138****5678");
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
        adminRole.GetProperty("permissions").GetArrayLength().ShouldBe(9);
    }

    [Fact]
    public async Task 角色目录_有用户读权限就能读()
    {
        // 角色目录是**用户管理的配套数据**：管用户的人（内容管理员也算）要能看到
        // 有哪些角色。按 user:read 判定，不再要 role:read——
        // 否则内容管理员的用户页上，角色筛选是空的、角色分配对话框也是空的。
        var adminToken = await LoginAsync(AdminUsername, AdminPassword);
        UseToken(adminToken);

        var created = await _client.PostAsJsonAsync(
            "/api/v1/users",
            new { username = "rolecat001", displayName = "只看角色目录", password = "Passw0rd!" });
        created.StatusCode.ShouldBe(HttpStatusCode.OK, await created.Content.ReadAsStringAsync());

        var users = await _client.GetAsync("/api/v1/users?keyword=rolecat001");
        var listBody = await users.Content.ReadFromJsonAsync<JsonElement>();
        var userId = listBody.GetProperty("items")[0].GetProperty("id").GetInt64();

        // 给他一个只有 user:read 的角色。
        var assign = await _client.PutAsJsonAsync(
            $"/api/v1/users/{userId}/roles",
            new { roleIds = new[] { _readerRoleId } });
        assign.StatusCode.ShouldBe(HttpStatusCode.OK, await assign.Content.ReadAsStringAsync());

        var readerToken = await LoginAsync("rolecat001", "Passw0rd!");
        UseToken(readerToken);

        var roles = await _client.GetAsync("/api/v1/roles");
        roles.StatusCode.ShouldBe(HttpStatusCode.OK, await roles.Content.ReadAsStringAsync());

        var roleList = await roles.Content.ReadFromJsonAsync<JsonElement>();
        roleList.GetArrayLength().ShouldBeGreaterThan(0);

        // 但**改**角色集合仍然要 role:write——矩阵里只给系统管理员。
        var denied = await _client.PutAsJsonAsync(
            $"/api/v1/users/{userId}/roles",
            new { roleIds = new[] { _readerRoleId } });
        denied.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
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

    [Fact]
    public async Task 组织标签_挂载后返回完整路径()
    {
        var adminToken = await LoginAsync(AdminUsername, AdminPassword);
        UseToken(adminToken);

        var facultyId = await CreateOrgTagAsync("org.cs.faculty", "计算机学院", null);
        var majorId = await CreateOrgTagAsync("org.cs.faculty.major", "计算机科学与技术", facultyId);
        var classId = await CreateOrgTagAsync("org.cs.faculty.major.c2301", "计科 2301 班", majorId);

        await _client.PostAsJsonAsync(
            "/api/v1/users",
            new { username = "orguser01", displayName = "林知远", password = "Passw0rd!" });

        var users = await _client.GetAsync("/api/v1/users?keyword=orguser01");
        var listBody = await users.Content.ReadFromJsonAsync<JsonElement>();
        var userId = listBody.GetProperty("items")[0].GetProperty("id").GetInt64();

        var assign = await _client.PutAsJsonAsync(
            $"/api/v1/users/{userId}/tags",
            new { tagIds = new[] { classId } });
        assign.StatusCode.ShouldBe(HttpStatusCode.OK, await assign.Content.ReadAsStringAsync());

        var tags = await _client.GetAsync($"/api/v1/users/{userId}/tags");
        tags.StatusCode.ShouldBe(HttpStatusCode.OK);

        var body = await tags.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("organizationPath").GetString()
            .ShouldBe("计算机学院 / 计算机科学与技术 / 计科 2301 班");
        body.GetProperty("tags")[0].GetProperty("name").GetString().ShouldBe("计科 2301 班");
    }

    [Fact]
    public async Task 组织标签_只接受组织维度()
    {
        var adminToken = await LoginAsync(AdminUsername, AdminPassword);
        UseToken(adminToken);

        var domainTagId = await CreateTagAsync("math", "高等数学", "domain", null, null);

        await _client.PostAsJsonAsync(
            "/api/v1/users",
            new { username = "badorg01", displayName = "越权组织", password = "Passw0rd!" });

        var users = await _client.GetAsync("/api/v1/users?keyword=badorg01");
        var listBody = await users.Content.ReadFromJsonAsync<JsonElement>();
        var userId = listBody.GetProperty("items")[0].GetProperty("id").GetInt64();

        var assign = await _client.PutAsJsonAsync(
            $"/api/v1/users/{userId}/tags",
            new { tagIds = new[] { domainTagId } });

        assign.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task 组织标签_被用户引用时不可删除()
    {
        var adminToken = await LoginAsync(AdminUsername, AdminPassword);
        UseToken(adminToken);

        var facultyId = await CreateOrgTagAsync("org.del.faculty", " deletable 学院", null);

        await _client.PostAsJsonAsync(
            "/api/v1/users",
            new { username = "delorg01", displayName = "引用者", password = "Passw0rd!" });

        var users = await _client.GetAsync("/api/v1/users?keyword=delorg01");
        var listBody = await users.Content.ReadFromJsonAsync<JsonElement>();
        var userId = listBody.GetProperty("items")[0].GetProperty("id").GetInt64();

        var assign = await _client.PutAsJsonAsync(
            $"/api/v1/users/{userId}/tags",
            new { tagIds = new[] { facultyId } });
        assign.StatusCode.ShouldBe(HttpStatusCode.OK);

        var delete = await _client.DeleteAsync($"/api/v1/tags/{facultyId}");
        delete.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);

        var problem = await delete.Content.ReadFromJsonAsync<JsonElement>();
        problem.GetProperty("errorCode").GetInt32().ShouldBe(22101);
    }

    [Fact]
    public async Task 名单导入_逐行处理且自动创建组织标签()
    {
        var adminToken = await LoginAsync(AdminUsername, AdminPassword);
        UseToken(adminToken);

        var csv = string.Join("\n", [
            "账号,姓名,学院,专业,班级,邮箱,角色",
            "20230001,张三,计算机学院,计算机科学与技术,计科2301班,zhangsan@example.edu,",
            "20230002,李四,计算机学院,计算机科学与技术,计科2302班,,",
            "20230003,王五,,,,,",
            "非法账号,赵六,计算机学院,,,",
            "20230001,张三改名,计算机学院,计算机科学与技术,计科2301班,,",
        ]);

        var response = await PostCsvAsync("/api/v1/users/import", csv, "名单.csv");
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("total").GetInt32().ShouldBe(5);
        body.GetProperty("created").GetInt32().ShouldBe(3);
        body.GetProperty("updated").GetInt32().ShouldBe(1);
        body.GetProperty("failed").GetArrayLength().ShouldBe(1);

        var failure = body.GetProperty("failed")[0];
        failure.GetProperty("rowNumber").GetInt32().ShouldBe(5);
        failure.GetProperty("reason").GetString()!.ShouldContain("账号格式不正确");

        // 自动创建的院系 / 专业 / 班级标签按层级挂接
        var tags = await _client.GetAsync("/api/v1/tags?group=organization");
        var tagBody = await tags.Content.ReadFromJsonAsync<JsonElement>();
        var organizationTags = tagBody.GetProperty("groups")[0].GetProperty("tags").EnumerateArray()
            .Select(t => t.GetProperty("name").GetString())
            .ToList();

        organizationTags.ShouldContain("计算机学院");
        organizationTags.ShouldContain("计算机科学与技术");
        organizationTags.ShouldContain("计科2301班");
        organizationTags.ShouldContain("计科2302班");
    }

    [Fact]
    public async Task 名单导入_重复账号更新且不重置密码()
    {
        var adminToken = await LoginAsync(AdminUsername, AdminPassword);
        UseToken(adminToken);

        var csv = string.Join("\n", [
            "账号,姓名,学院,专业,班级",
            "20231001,周八,数学学院,数学,数应2301班",
        ]);

        var first = await PostCsvAsync("/api/v1/users/import", csv, "名单.csv");
        first.StatusCode.ShouldBe(HttpStatusCode.OK, await first.Content.ReadAsStringAsync());

        var firstBody = await first.Content.ReadFromJsonAsync<JsonElement>();
        var generatedPassword = firstBody.GetProperty("generatedPasswords")[0].GetProperty("password").GetString();
        generatedPassword.ShouldNotBeNullOrWhiteSpace();

        // 再次导入同一账号：更新而非报错，密码保持不变。
        var second = await PostCsvAsync("/api/v1/users/import", csv, "名单.csv");
        second.StatusCode.ShouldBe(HttpStatusCode.OK, await second.Content.ReadAsStringAsync());

        var secondBody = await second.Content.ReadFromJsonAsync<JsonElement>();
        secondBody.GetProperty("created").GetInt32().ShouldBe(0);
        secondBody.GetProperty("updated").GetInt32().ShouldBe(1);
        secondBody.GetProperty("failed").GetArrayLength().ShouldBe(0);

        var login = await _client.PostAsJsonAsync(
            "/api/v1/auth/login",
            new { username = "20231001", password = generatedPassword });
        login.StatusCode.ShouldBe(HttpStatusCode.OK, "重复导入不应重置密码。");
    }

    [Fact]
    public async Task 名单导入_三列为空的账号是社会人士且不挂组织标签()
    {
        var adminToken = await LoginAsync(AdminUsername, AdminPassword);
        UseToken(adminToken);

        var csv = string.Join("\n", [
            "账号,姓名,学院,专业,班级",
            "20232001,吴九,,,",
        ]);

        var response = await PostCsvAsync("/api/v1/users/import", csv, "名单.csv");
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var users = await _client.GetAsync("/api/v1/users?keyword=20232001");
        var listBody = await users.Content.ReadFromJsonAsync<JsonElement>();
        var item = listBody.GetProperty("items")[0];
        item.GetProperty("roles")[0].GetString().ShouldBe("general_user");

        var userId = item.GetProperty("id").GetInt64();
        var tags = await _client.GetAsync($"/api/v1/users/{userId}/tags");
        var tagBody = await tags.Content.ReadFromJsonAsync<JsonElement>();
        tagBody.GetProperty("tags").GetArrayLength().ShouldBe(0);
        tagBody.GetProperty("organizationPath").ValueKind.ShouldBe(System.Text.Json.JsonValueKind.Null);
    }

    [Fact]
    public async Task 审计日志_记录关键操作并可查询()
    {
        var adminToken = await LoginAsync(AdminUsername, AdminPassword);
        UseToken(adminToken);

        await _client.PostAsJsonAsync(
            "/api/v1/users",
            new { username = "audited01", displayName = "被审计者", password = "Passw0rd!" });

        var users = await _client.GetAsync("/api/v1/users?keyword=audited01");
        var listBody = await users.Content.ReadFromJsonAsync<JsonElement>();
        var userId = listBody.GetProperty("items")[0].GetProperty("id").GetInt64();

        await _client.PutAsJsonAsync(
            $"/api/v1/users/{userId}",
            new { displayName = "改名了", status = "active" });

        var logs = await _client.GetAsync($"/api/v1/audit-logs?targetType=user&targetId={userId}");
        logs.StatusCode.ShouldBe(HttpStatusCode.OK, await logs.Content.ReadAsStringAsync());

        var body = await logs.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("total").GetInt32().ShouldBeGreaterThan(0);

        var items = body.GetProperty("items").EnumerateArray()
            .Select(x => $"{x.GetProperty("action").GetString()}::{x.GetProperty("summary").GetString()}")
            .ToList();

        items.ShouldContain(x => x.StartsWith("user.update"));
        items.ShouldContain(x => x.StartsWith("entity.user.updated"));
        items.Count.ShouldBe(3, $"审计条目：{string.Join(" | ", items)}");
    }

    [Fact]
    public async Task 审计日志_无权限时拒绝()
    {
        var adminToken = await LoginAsync(AdminUsername, AdminPassword);
        UseToken(adminToken);

        await _client.PostAsJsonAsync(
            "/api/v1/users",
            new { username = "noperm001", displayName = "无权限", password = "Passw0rd!" });

        var users = await _client.GetAsync("/api/v1/users?keyword=noperm001");
        var listBody = await users.Content.ReadFromJsonAsync<JsonElement>();
        var userId = listBody.GetProperty("items")[0].GetProperty("id").GetInt64();

        var targetToken = await LoginAsync("noperm001", "Passw0rd!");
        UseToken(targetToken);

        var response = await _client.GetAsync("/api/v1/audit-logs");
        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    private async Task<HttpResponseMessage> PostCsvAsync(string path, string content, string fileName)
    {
        using var body = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(System.Text.Encoding.UTF8.GetBytes(content));
        fileContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("text/csv");
        body.Add(fileContent, "file", fileName);

        return await _client.PostAsync(path, body);
    }

    private async Task<long> CreateOrgTagAsync(string code, string name, long? parentId)
    {
        var response = await _client.PostAsJsonAsync(
            "/api/v1/tags",
            new { code, name, group = "organization", parentId, sortOrder = 0 });

        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("id").GetInt64();
    }

    private async Task<long> CreateTagAsync(string code, string name, string group, long? parentId, int? level)
    {
        var response = await _client.PostAsJsonAsync(
            "/api/v1/tags",
            new { code, name, group, parentId, level, sortOrder = 0 });

        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("id").GetInt64();
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

    private static async Task SeedSystemRoleAsync(AppDbContext db, string code, string name)
    {
        var exists = await db.Roles.AnyAsync(r => r.Code == code);
        if (exists)
        {
            return;
        }

        await db.Roles.AddAsync(Role.CreateSystem(code, name, DateTimeOffset.UtcNow));
        await db.SaveChangesAsync();
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

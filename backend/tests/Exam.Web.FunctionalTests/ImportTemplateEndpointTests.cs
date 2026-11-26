using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Exam.Domain.Catalog;
using Exam.Domain.Identity;
using Exam.Infrastructure.Identity;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;
using Testcontainers.PostgreSql;

namespace Exam.Web.FunctionalTests;

/// <summary>
/// 导入模板端点。
/// <para>
/// 老师拿到手的第一份说明就是模板：它说「哪一列填什么」，解析器决定
/// 「这一列读进哪个字段」。这里验的不只是端点通不通——
/// 还有**模板里的示例行自己就能通过解析**（模板与解析规则同源）。
/// </para>
/// </summary>
public sealed class ImportTemplateEndpointTests : IAsyncLifetime
{
    private const string AdminUsername = "tmpladmin01";
    private const string AdminPassword = "Passw0rd!";

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

        var roleId = await SeedRoleAsync(db);
        await SeedUserAsync(db, AdminUsername, AdminPassword, roleId);

        // 模板的示例行里用到了这些标签：难度「中等」「较难」、知识点「计算机网络」「TCP」。
        var now = DateTimeOffset.UtcNow;
        await db.Tags.AddAsync(Tag.Create("difficulty.mid", "中等", TagGroup.Difficulty, 2, null, 0, now));
        await db.Tags.AddAsync(Tag.Create("difficulty.hard", "较难", TagGroup.Difficulty, 3, null, 0, now));
        await db.Tags.AddAsync(Tag.Create("knowledge.net", "计算机网络", TagGroup.KnowledgePoint, null, null, 0, now));
        await db.Tags.AddAsync(Tag.Create("knowledge.tcp", "TCP", TagGroup.KnowledgePoint, null, null, 0, now));
        await db.SaveChangesAsync();
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 取模板_给出列说明与说明条目()
    {
        await LoginAsync();

        var response = await _client.GetAsync("/api/v1/imports/template");
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        body.GetProperty("fileName").GetString().ShouldBe("试题导入模板.csv");
        body.GetProperty("csv").GetString().ShouldNotBeNullOrWhiteSpace();
        body.GetProperty("notes").GetArrayLength().ShouldBeGreaterThan(0);

        var columns = body.GetProperty("columns");
        columns.GetArrayLength().ShouldBe(QuestionImportTemplate.Columns.Count);

        var headers = columns.EnumerateArray().Select(c => c.GetProperty("header").GetString()!).ToList();
        headers.ShouldBe(QuestionImportTemplate.Headers);

        // 必填列要标出来，界面上才提示得清楚。
        var type = columns.EnumerateArray().Single(c => c.GetProperty("field").GetString() == "type");
        type.GetProperty("required").GetBoolean().ShouldBeTrue();
        type.GetProperty("description").GetString().ShouldNotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task 模板里的示例行自己就能通过解析()
    {
        await LoginAsync();

        var template = await _client.GetFromJsonAsync<JsonElement>("/api/v1/imports/template");
        var csv = template.GetProperty("csv").GetString()!;

        using var body = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(Encoding.UTF8.GetBytes(csv));
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("text/csv");
        body.Add(fileContent, "file", "模板.csv");

        var response = await _client.PostAsync("/api/v1/imports", body);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var uploaded = await response.Content.ReadFromJsonAsync<JsonElement>();
        var batch = uploaded.GetProperty("batch");

        // 两行示例都合法：模板与解析规则同源，不是各说各话。
        batch.GetProperty("totalRows").GetInt32().ShouldBe(2);
        batch.GetProperty("validRows").GetInt32().ShouldBe(2);
        batch.GetProperty("invalidRows").GetInt32().ShouldBe(0);
    }

    private async Task LoginAsync()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/v1/auth/login",
            new { username = AdminUsername, password = AdminPassword });

        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        _client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", body.GetProperty("accessToken").GetString());
    }

    private static async Task<long> SeedRoleAsync(AppDbContext db)
    {
        var now = DateTimeOffset.UtcNow;
        var role = Role.Create("template_admin", "模板管理员", now);
        await db.Roles.AddAsync(role);
        await db.SaveChangesAsync();

        string[] codes = [PermissionCatalog.ImportRun, PermissionCatalog.ImportAdopt, PermissionCatalog.QuestionRead];

        foreach (var code in codes)
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

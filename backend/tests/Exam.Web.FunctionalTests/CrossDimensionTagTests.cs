using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
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
/// 标签跨维度成树。
/// <para>
/// 需求 FR-CAT-02 的验收例子：「选『高等数学』命中其下所有知识点」——
/// 高等数学是**领域**标签，它下面挂的是**知识点**标签，所以内容维度之间
/// 必须能成树（跨维度）。难度维度平铺、组织维度只作用于用户，都不成树。
/// </para>
/// </summary>
public sealed class CrossDimensionTagTests : IAsyncLifetime
{
    private const string AdminUsername = "crossdim01";
    private const string AdminPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _difficultyTagId;

    public async Task InitializeAsync()
    {
        await _postgres.StartAsync();

        _factory = new ExamWebFactory(_postgres.GetConnectionString());
        _client = _factory.CreateClient();
        _client.BaseAddress = new Uri("http://localhost");

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.MigrateAsync();

        await SeedUserAsync(
            db,
            AdminUsername,
            AdminPassword,
            [
                PermissionCatalog.TagRead,
                PermissionCatalog.TagWrite,
                PermissionCatalog.QuestionRead,
                PermissionCatalog.QuestionWrite,
                PermissionCatalog.QuestionPublish,
            ]);

        var difficulty = Tag.Create(
            "difficulty.basic", "基础", TagGroup.Difficulty, 1, null, 0, DateTimeOffset.UtcNow);
        await db.Tags.AddAsync(difficulty);
        await db.SaveChangesAsync();
        _difficultyTagId = difficulty.Id;
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 知识点可以挂在领域标签下()
    {
        await LoginAsync();

        var domainId = await CreateTagAsync("math", "高等数学", "domain");
        var childId = await CreateTagAsync("math.limit", "极限", "knowledge_point", domainId);

        // 后代展开跨维度也认。
        var descendants = await _client.GetAsync($"/api/v1/tags/{domainId}/descendants");
        descendants.StatusCode.ShouldBe(HttpStatusCode.OK, await descendants.Content.ReadAsStringAsync());

        var body = await descendants.Content.ReadFromJsonAsync<JsonElement>();
        var ids = body.GetProperty("ids").EnumerateArray().Select(x => x.GetInt64()).ToList();
        ids.ShouldContain(childId);
    }

    [Fact]
    public async Task 选高等数学命中其下所有知识点()
    {
        await LoginAsync();

        var domainId = await CreateTagAsync("math", "高等数学", "domain");
        var knowledgeId = await CreateTagAsync("math.limit", "极限", "knowledge_point", domainId);

        // 一道只挂了「极限」的题。
        var questionId = await CreateQuestionAsync("Q-CROSS-001", knowledgeId);

        // 选「高等数学」+「包含子标签」→ 命中那道题（FR-CAT-02）。
        var hit = await _client.GetAsync($"/api/v1/questions?tagIds={domainId}&includeDescendants=true");
        hit.StatusCode.ShouldBe(HttpStatusCode.OK, await hit.Content.ReadAsStringAsync());

        var hitBody = await hit.Content.ReadFromJsonAsync<JsonElement>();
        hitBody.GetProperty("items").EnumerateArray()
            .Select(x => x.GetProperty("id").GetInt64())
            .ShouldContain(questionId);

        // 关掉「包含子标签」就只命中自己，题不在里面。
        var miss = await _client.GetAsync($"/api/v1/questions?tagIds={domainId}&includeDescendants=false");
        var missBody = await miss.Content.ReadFromJsonAsync<JsonElement>();
        missBody.GetProperty("items").EnumerateArray()
            .Select(x => x.GetProperty("id").GetInt64())
            .ShouldNotContain(questionId);
    }

    [Fact]
    public async Task 组织维度的标签不能当别的维度的父标签()
    {
        await LoginAsync();

        // 组织维度的标签由名单导入自动创建，这里直接造一个。
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var orgTag = Tag.Create(
                "org.cs.faculty", "计算机学院", TagGroup.Organization, null, null, 0, DateTimeOffset.UtcNow);
            await db.Tags.AddAsync(orgTag);
            await db.SaveChangesAsync();
        }

        var orgList = await _client.GetAsync("/api/v1/tags?group=organization");
        orgList.StatusCode.ShouldBe(HttpStatusCode.OK, await orgList.Content.ReadAsStringAsync());

        var orgBody = await orgList.Content.ReadFromJsonAsync<JsonElement>();
        var orgId = orgBody.GetProperty("groups")[0].GetProperty("tags")[0].GetProperty("id").GetInt64();

        // 组织维度只作用于用户（FR-CAT-01 的维度隔离），不能当题目标签的父。
        var rejected = await _client.PostAsJsonAsync(
            "/api/v1/tags",
            new { code = "math.limit", name = "极限", group = "knowledge_point", parentId = orgId });

        rejected.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity, await rejected.Content.ReadAsStringAsync());
    }

    private async Task<long> CreateTagAsync(string code, string name, string group, long? parentId = null)
    {
        var response = await _client.PostAsJsonAsync(
            "/api/v1/tags",
            new { code, name, group, parentId, sortOrder = 0 });

        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("id").GetInt64();
    }

    private async Task<long> CreateQuestionAsync(string code, long tagId)
    {
        var response = await _client.PostAsJsonAsync(
            "/api/v1/questions",
            new
            {
                code,
                type = "single",
                stem = "下列哪个是正确的？",
                defaultScore = 5,
                difficultyTagId = _difficultyTagId,
                tagIds = new[] { tagId },
                options = new object[]
                {
                    new { key = "A", text = "甲", isCorrect = true },
                    new { key = "B", text = "乙", isCorrect = false },
                },
            });

        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var id = body.GetProperty("question").GetProperty("id").GetInt64();

        var publish = await _client.PostAsync($"/api/v1/questions/{id}/publish", null);
        publish.StatusCode.ShouldBe(HttpStatusCode.OK, await publish.Content.ReadAsStringAsync());

        return id;
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

    private static async Task SeedUserAsync(
        AppDbContext db,
        string username,
        string password,
        string[] permissions)
    {
        var verifier = new Pbkdf2PasswordVerifier();
        var now = DateTimeOffset.UtcNow;

        var user = User.Register(username, username, verifier.Hash(password), now);
        await db.Users.AddAsync(user);
        await db.SaveChangesAsync();

        var role = Role.Create($"{username}_role", username, now);
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

        await db.UserRoles.AddAsync(UserRole.Create(user.Id, role.Id, null, now));
        await db.SaveChangesAsync();
    }
}

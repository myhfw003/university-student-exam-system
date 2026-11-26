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
/// AI 生成试题端点。
/// <para>
/// 关键不在「模型有没有被调用」，而在**调用之后**：
/// 通得过校验的题要落成草稿候选题，通不过的不能落库、还要说清哪里不合法，
/// 服务端没配 Key 时要明确告诉用户（而不是一句「生成失败」）。
/// </para>
/// </summary>
public sealed class AiGenerationEndpointTests : IAsyncLifetime
{
    private const string AdminUsername = "aiadmin01";
    private const string AdminPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _difficultyTagId;
    private long _knowledgeTagId;

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

        var now = DateTimeOffset.UtcNow;
        var difficulty = Tag.Create("difficulty.mid", "中等", TagGroup.Difficulty, 2, null, 0, now);
        var knowledge = Tag.Create("knowledge.tcp", "TCP", TagGroup.KnowledgePoint, null, null, 0, now);
        await db.Tags.AddAsync(difficulty);
        await db.Tags.AddAsync(knowledge);
        await db.SaveChangesAsync();

        _difficultyTagId = difficulty.Id;
        _knowledgeTagId = knowledge.Id;
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 供应商列表给出模型与配置状态()
    {
        await LoginAsync();

        var response = await _client.GetAsync("/api/v1/ai/providers");
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var providers = body.GetProperty("providers");

        providers.GetArrayLength().ShouldBe(1);
        var provider = providers[0];
        provider.GetProperty("name").GetString().ShouldBe("stub");
        provider.GetProperty("configured").GetBoolean().ShouldBeTrue();
        provider.GetProperty("defaultModel").GetString().ShouldBe("stub-model");
        provider.GetProperty("models").GetArrayLength().ShouldBe(2);
    }

    [Fact]
    public async Task 生成试题_通过校验的题落成草稿候选题()
    {
        await LoginAsync();

        // 实测 MiniMax 的返回形状：选项是对象映射，不是数组。
        _factory.AiProvider.Content = """
            [{"stem":"TCP 建立连接时采用三次握手，其主要目的是：","type":"single","options":{"A":"提高可靠性","B":"确认双方的收发能力"},"answer":"B","analysis":"三次握手确认双方收发能力。"}]
            """;

        var response = await _client.PostAsJsonAsync(
            "/api/v1/ai/generations",
            new
            {
                provider = "stub",
                model = "stub-model",
                count = 1,
                type = "single",
                difficultyTagId = _difficultyTagId,
                tagIds = new[] { _knowledgeTagId },
                prompt = "围绕 TCP 三次握手出单选题",
            });

        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("succeeded").GetInt32().ShouldBe(1);
        body.GetProperty("failed").GetInt32().ShouldBe(0);

        var item = body.GetProperty("items")[0];
        item.GetProperty("succeeded").GetBoolean().ShouldBeTrue();
        item.GetProperty("stem").GetString()!.ShouldContain("三次握手");

        // 题目落库了：草稿、来源是 generated、挂着难度与知识点。
        var questions = await _client.GetAsync("/api/v1/questions?status=draft");
        questions.StatusCode.ShouldBe(HttpStatusCode.OK);

        var list = await questions.Content.ReadFromJsonAsync<JsonElement>();
        list.GetProperty("total").GetInt32().ShouldBe(1);

        var question = list.GetProperty("items")[0];
        question.GetProperty("status").GetString().ShouldBe("draft");
        question.GetProperty("source").GetString().ShouldBe("generated");
        question.GetProperty("difficultyTagId").GetInt64().ShouldBe(_difficultyTagId);
        question.GetProperty("tagIds").EnumerateArray().Select(t => t.GetInt64()).ShouldContain(_knowledgeTagId);
    }

    [Fact]
    public async Task 生成试题_通不过校验的题不落库并说明原因()
    {
        await LoginAsync();

        // 多选题却只有一个正确答案：解析能过，发布校验过不去。
        _factory.AiProvider.Content = """
            [{"stem":"多选题只有一个正确答案","type":"multi","options":{"A":"甲","B":"乙"},"answer":"A"}]
            """;

        var response = await _client.PostAsJsonAsync(
            "/api/v1/ai/generations",
            new
            {
                provider = "stub",
                model = "stub-model",
                count = 1,
                type = "multi",
                difficultyTagId = _difficultyTagId,
                tagIds = Array.Empty<long>(),
                prompt = "围绕 TCP 出多选题",
            });

        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("succeeded").GetInt32().ShouldBe(0);
        body.GetProperty("failed").GetInt32().ShouldBe(1);

        var item = body.GetProperty("items")[0];
        item.GetProperty("succeeded").GetBoolean().ShouldBeFalse();
        item.GetProperty("errors").EnumerateArray().First().GetString()!.ShouldContain("正确选项");

        // 通不过的题不落库。
        var questions = await _client.GetAsync("/api/v1/questions?status=draft");
        var list = await questions.Content.ReadFromJsonAsync<JsonElement>();
        list.GetProperty("total").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task 生成试题_出题要求与难度知识点传给模型()
    {
        await LoginAsync();

        _factory.AiProvider.Content = "[]";

        await _client.PostAsJsonAsync(
            "/api/v1/ai/generations",
            new
            {
                provider = "stub",
                model = "stub-model-fast",
                count = 2,
                type = "single",
                difficultyTagId = _difficultyTagId,
                tagIds = new[] { _knowledgeTagId },
                prompt = "围绕 TCP 三次握手出单选题",
            });

        var request = _factory.AiProvider.LastRequest;
        request.ShouldNotBeNull();
        request!.Prompt.ShouldBe("围绕 TCP 三次握手出单选题");
        request.Count.ShouldBe(2);
        request.Type.ShouldBe(QuestionType.Single);
        request.DifficultyName.ShouldBe("中等");
        request.KnowledgePointNames.ShouldContain("TCP");
    }

    [Fact]
    public async Task 服务端未配置APIKey时明确报422()
    {
        await LoginAsync();

        _factory.AiProvider.IsConfigured = false;

        var response = await _client.PostAsJsonAsync(
            "/api/v1/ai/generations",
            new
            {
                provider = "stub",
                model = "stub-model",
                count = 1,
                type = "single",
                difficultyTagId = _difficultyTagId,
                tagIds = Array.Empty<long>(),
                prompt = "出题",
            });

        response.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("errorCode").GetInt32().ShouldBe(27101);
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
        var role = Role.Create("ai_admin", "AI 生成管理员", now);
        await db.Roles.AddAsync(role);
        await db.SaveChangesAsync();

        string[] codes =
        [
            PermissionCatalog.AiGenerate,
            PermissionCatalog.QuestionRead,
            PermissionCatalog.QuestionWrite,
            PermissionCatalog.TagRead,
        ];

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

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

/// <summary>组卷方案的端到端测试。</summary>
public sealed class BlueprintEndpointTests : IAsyncLifetime
{
    private const string AdminUsername = "bpaladmin1";
    private const string AdminPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _basicDifficultyId;
    private long _mediumDifficultyId;
    private long _subjectTagId;

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
        var basic = Tag.Create("difficulty.basic", "基础", TagGroup.Difficulty, 1, null, 0, now);
        var medium = Tag.Create("difficulty.medium", "中等", TagGroup.Difficulty, 3, null, 1, now);
        var subject = Tag.Create("subject.network", "计算机网络", TagGroup.KnowledgePoint, null, null, 0, now);
        await db.Tags.AddRangeAsync(basic, medium, subject);
        await db.SaveChangesAsync();

        _basicDifficultyId = basic.Id;
        _mediumDifficultyId = medium.Id;
        _subjectTagId = subject.Id;

        await SeedQuestionAsync(db, "Q-BP-001", _basicDifficultyId, _subjectTagId);
        await SeedQuestionAsync(db, "Q-BP-002", _basicDifficultyId, _subjectTagId);
        await SeedQuestionAsync(db, "Q-BP-003", _basicDifficultyId, _subjectTagId);
        await SeedQuestionAsync(db, "Q-BP-004", _mediumDifficultyId, _subjectTagId);
        await SeedQuestionAsync(db, "Q-BP-005", _mediumDifficultyId, _subjectTagId);
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 保存规则后可以取回方案()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync();

        var save = await _client.PutAsJsonAsync(
            $"/api/v1/papers/{paperId}/blueprint",
            new
            {
                seed = "BP-SEED-1",
                rules = new
                {
                    tagIds = new[] { _subjectTagId },
                    includeDescendants = true,
                    matchMode = "any",
                    difficultyQuota = new Dictionary<long, int> { [_basicDifficultyId] = 2 },
                    typeQuota = new Dictionary<string, int> { ["single"] = 2 },
                    targetTotalScore = 10,
                    orderRule = "by_type",
                    scoreAllocation = "even",
                },
            });

        save.StatusCode.ShouldBe(HttpStatusCode.OK, await save.Content.ReadAsStringAsync());

        var body = await save.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("seed").GetString().ShouldBe("BP-SEED-1");
        body.GetProperty("status").GetString().ShouldBe("draft");
        body.GetProperty("rules").GetProperty("targetTotalScore").GetDecimal().ShouldBe(10m);

        var get = await _client.GetAsync($"/api/v1/papers/{paperId}/blueprint");
        get.StatusCode.ShouldBe(HttpStatusCode.OK);
        var getBody = await get.Content.ReadFromJsonAsync<JsonElement>();
        getBody.GetProperty("seed").GetString().ShouldBe("BP-SEED-1");
    }

    [Fact]
    public async Task 生成后试卷题位被替换且总分精确等于目标()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync();
        await SaveRulesAsync(paperId, "BP-SEED-2", basic: 2, medium: 0, single: 2, target: 10m);

        var generate = await _client.PostAsync($"/api/v1/papers/{paperId}/blueprint/generate", null);
        generate.StatusCode.ShouldBe(HttpStatusCode.OK, await generate.Content.ReadAsStringAsync());

        var body = await generate.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("generatedItemCount").GetInt32().ShouldBe(2);
        body.GetProperty("totalScore").GetDecimal().ShouldBe(10m);
        body.GetProperty("status").GetString().ShouldBe("generated");

        var items = body.GetProperty("items");
        items.GetArrayLength().ShouldBe(2);
        items[0].GetProperty("matchReason").GetArrayLength().ShouldBeGreaterThan(0);

        var paper = await _client.GetAsync($"/api/v1/papers/{paperId}");
        paper.StatusCode.ShouldBe(HttpStatusCode.OK);
        var paperBody = await paper.Content.ReadFromJsonAsync<JsonElement>();
        paperBody.GetProperty("items").GetArrayLength().ShouldBe(2);
        paperBody.GetProperty("paper").GetProperty("totalItemScore").GetDecimal().ShouldBe(10m);
    }

    [Fact]
    public async Task 同种子重复生成结果一致()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync();
        await SaveRulesAsync(paperId, "BP-SEED-3", basic: 2, medium: 0, single: 2, target: 10m);

        var first = await _client.PostAsync($"/api/v1/papers/{paperId}/blueprint/generate", null);
        first.StatusCode.ShouldBe(HttpStatusCode.OK, await first.Content.ReadAsStringAsync());
        var firstBody = await first.Content.ReadFromJsonAsync<JsonElement>();

        var second = await _client.PostAsync($"/api/v1/papers/{paperId}/blueprint/generate", null);
        second.StatusCode.ShouldBe(HttpStatusCode.OK, await second.Content.ReadAsStringAsync());
        var secondBody = await second.Content.ReadFromJsonAsync<JsonElement>();

        var firstIds = firstBody.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("questionId").GetInt64()).ToList();
        var secondIds = secondBody.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("questionId").GetInt64()).ToList();

        secondIds.ShouldBe(firstIds);
    }

    [Fact]
    public async Task 题池不足时返回缺口明细()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync();

        // 难度配额要 4 道中等题，题库里只有 2 道。
        await SaveRulesAsync(paperId, "BP-SEED-4", basic: 0, medium: 4, single: 4, target: 20m);

        var generate = await _client.PostAsync($"/api/v1/papers/{paperId}/blueprint/generate", null);
        generate.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);

        var problem = await generate.Content.ReadFromJsonAsync<JsonElement>();
        problem.GetProperty("errorCode").GetInt32().ShouldBe(23101);

        var shortfalls = problem.GetProperty("shortfalls");
        shortfalls.GetArrayLength().ShouldBe(1);

        var shortfall = shortfalls[0];
        shortfall.GetProperty("required").GetInt32().ShouldBe(4);
        shortfall.GetProperty("available").GetInt32().ShouldBe(2);
        shortfall.GetProperty("type").GetString().ShouldBe("single");
        shortfall.GetProperty("reason").GetString()!.ShouldContain("仅有 2 道");
    }

    [Fact]
    public async Task 手工改动题位后差异接口能看出来()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync();
        await SaveRulesAsync(paperId, "BP-SEED-5", basic: 2, medium: 0, single: 2, target: 10m);

        await _client.PostAsync($"/api/v1/papers/{paperId}/blueprint/generate", null);

        var diff = await _client.GetAsync($"/api/v1/papers/{paperId}/blueprint/diff");
        diff.StatusCode.ShouldBe(HttpStatusCode.OK, await diff.Content.ReadAsStringAsync());

        var body = await diff.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("added").GetArrayLength().ShouldBe(0);
        body.GetProperty("removed").GetArrayLength().ShouldBe(0);
        body.GetProperty("changed").GetArrayLength().ShouldBe(0);

        // 手工调一个题位的分值，差异应当报出来。
        var paper = await _client.GetAsync($"/api/v1/papers/{paperId}");
        var paperBody = await paper.Content.ReadFromJsonAsync<JsonElement>();
        var itemId = paperBody.GetProperty("items")[0].GetProperty("id").GetInt64();

        var update = await _client.PutAsJsonAsync(
            $"/api/v1/papers/{paperId}/items/{itemId}",
            new { score = 2.5m });
        update.StatusCode.ShouldBe(HttpStatusCode.OK, await update.Content.ReadAsStringAsync());

        var diffAfter = await _client.GetAsync($"/api/v1/papers/{paperId}/blueprint/diff");
        var diffBody = await diffAfter.Content.ReadFromJsonAsync<JsonElement>();
        diffBody.GetProperty("changed").GetArrayLength().ShouldBe(1);
        diffBody.GetProperty("changed")[0].GetProperty("currentScore").GetDecimal().ShouldBe(2.5m);
    }

    [Fact]
    public async Task 已发布试卷不能重新组卷()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync();
        await SaveRulesAsync(paperId, "BP-SEED-6", basic: 2, medium: 0, single: 2, target: 10m);
        await _client.PostAsync($"/api/v1/papers/{paperId}/blueprint/generate", null);

        // 生成后题位分值合计等于目标总分，可以直接发布。
        var publish = await _client.PostAsync($"/api/v1/papers/{paperId}/publish", null);
        publish.StatusCode.ShouldBe(HttpStatusCode.OK, await publish.Content.ReadAsStringAsync());

        var generate = await _client.PostAsync($"/api/v1/papers/{paperId}/blueprint/generate", null);
        generate.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);

        var problem = await generate.Content.ReadFromJsonAsync<JsonElement>();
        problem.GetProperty("errorCode").GetInt32().ShouldBe(24101);
    }

    [Fact]
    public async Task 没有方案时生成会提示先保存规则()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync();

        var generate = await _client.PostAsync($"/api/v1/papers/{paperId}/blueprint/generate", null);
        generate.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    private async Task SaveRulesAsync(
        long paperId,
        string seed,
        int basic,
        int medium,
        int single,
        decimal target)
    {
        var difficultyQuota = new Dictionary<long, int>();
        if (basic > 0)
        {
            difficultyQuota[_basicDifficultyId] = basic;
        }

        if (medium > 0)
        {
            difficultyQuota[_mediumDifficultyId] = medium;
        }

        var save = await _client.PutAsJsonAsync(
            $"/api/v1/papers/{paperId}/blueprint",
            new
            {
                seed,
                rules = new
                {
                    tagIds = new[] { _subjectTagId },
                    includeDescendants = true,
                    matchMode = "any",
                    difficultyQuota,
                    typeQuota = new Dictionary<string, int> { ["single"] = single },
                    targetTotalScore = target,
                    orderRule = "by_type",
                    scoreAllocation = "even",
                },
            });

        save.StatusCode.ShouldBe(HttpStatusCode.OK, await save.Content.ReadAsStringAsync());
    }

    private async Task<long> CreatePaperAsync()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/v1/papers",
            new
            {
                kind = "exam",
                name = "计算机网络期中考试",
                targetTotalScore = 10,
                durationMinutes = 15,
            });

        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("paper").GetProperty("id").GetInt64();
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

    private static async Task SeedQuestionAsync(
        AppDbContext db,
        string code,
        long difficultyTagId,
        long subjectTagId)
    {
        var now = DateTimeOffset.UtcNow;
        var question = Question.CreateDraft(code, QuestionType.Single, "题干", Score.Question(5), difficultyTagId, now);
        question.AddOption(QuestionOption.Create("A", "甲", true, 0), now);
        question.AddOption(QuestionOption.Create("B", "乙", false, 1), now);
        question.AttachTag(subjectTagId, now);

        await db.Questions.AddAsync(question);
        await db.SaveChangesAsync();

        question.Publish(now);
        await db.SaveChangesAsync();
    }

    private static async Task<long> SeedRoleAsync(AppDbContext db)
    {
        var now = DateTimeOffset.UtcNow;
        var role = Role.Create("blueprint_admin", "组卷管理员", now);
        await db.Roles.AddAsync(role);
        await db.SaveChangesAsync();

        string[] codes =
        [
            PermissionCatalog.PaperRead,
            PermissionCatalog.PaperWrite,
            PermissionCatalog.PaperPublish,
            PermissionCatalog.BlueprintGenerate,
            PermissionCatalog.QuestionRead,
            PermissionCatalog.QuestionWrite,
            PermissionCatalog.QuestionPublish,
            PermissionCatalog.TagRead,
            PermissionCatalog.TagWrite,
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

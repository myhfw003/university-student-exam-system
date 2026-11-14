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

/// <summary>试卷端点的端到端测试。</summary>
public sealed class PaperEndpointTests : IAsyncLifetime
{
    private const string AdminUsername = "paperadmin1";
    private const string AdminPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _difficultyTagId;
    private long _publishedQuestionId;
    private long _draftQuestionId;

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
        var difficulty = Tag.Create("difficulty.basic", "基础", TagGroup.Difficulty, 1, null, 0, now);
        await db.Tags.AddAsync(difficulty);
        await db.SaveChangesAsync();
        _difficultyTagId = difficulty.Id;

        _publishedQuestionId = await SeedQuestionAsync(db, "Q-PUB-001", publish: true);
        _draftQuestionId = await SeedQuestionAsync(db, "Q-DRAFT-001", publish: false);
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 新建试卷_返回草稿()
    {
        await LoginAsync();

        var response = await _client.PostAsJsonAsync(
            "/api/v1/papers",
            new
            {
                kind = "exam",
                name = "计算机网络期中考试",
                targetTotalScore = 10,
                durationMinutes = 90,
                passScore = 6,
            });

        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("paper").GetProperty("status").GetString().ShouldBe("draft");
        body.GetProperty("paper").GetProperty("kind").GetString().ShouldBe("exam");
        body.GetProperty("paper").GetProperty("targetTotalScore").GetDecimal().ShouldBe(10m);
        body.GetProperty("items").GetArrayLength().ShouldBe(0);
    }

    [Fact]
    public async Task 追加题位_题位分值之和可查()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync(totalScore: 10m);

        var add = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/items",
            new { questionId = _publishedQuestionId, score = 10m });
        add.StatusCode.ShouldBe(HttpStatusCode.OK, await add.Content.ReadAsStringAsync());

        var body = await add.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("items").GetArrayLength().ShouldBe(1);
        body.GetProperty("paper").GetProperty("totalItemScore").GetDecimal().ShouldBe(10m);
    }

    [Fact]
    public async Task 草稿题目不能入卷()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync(totalScore: 5m);

        var add = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/items",
            new { questionId = _draftQuestionId, score = 5m });

        add.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task 同一道题不能重复入卷()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync(totalScore: 10m);

        await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/items",
            new { questionId = _publishedQuestionId, score = 5m });

        var again = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/items",
            new { questionId = _publishedQuestionId, score = 5m });

        again.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task 发布校验_分数不一致时阻断()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync(totalScore: 10m);
        await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/items",
            new { questionId = _publishedQuestionId, score = 5m });

        var validate = await _client.PostAsync($"/api/v1/papers/{paperId}/validate", null);
        validate.StatusCode.ShouldBe(HttpStatusCode.OK);

        var body = await validate.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("hasBlockingFailure").GetBoolean().ShouldBeTrue();

        var score = body.GetProperty("items").EnumerateArray()
            .First(i => i.GetProperty("key").GetString() == "score");
        score.GetProperty("passed").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task 发布_校验不通过时拒绝()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync(totalScore: 10m);
        await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/items",
            new { questionId = _publishedQuestionId, score = 5m });

        var publish = await _client.PostAsync($"/api/v1/papers/{paperId}/publish", null);
        publish.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);

        var problem = await publish.Content.ReadFromJsonAsync<JsonElement>();
        problem.GetProperty("errorCode").GetInt32().ShouldBe(24001);
    }

    [Fact]
    public async Task 发布_校验通过后进入已发布且题位不可改()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync(totalScore: 10m);
        await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/items",
            new { questionId = _publishedQuestionId, score = 10m });

        var publish = await _client.PostAsync($"/api/v1/papers/{paperId}/publish", null);
        publish.StatusCode.ShouldBe(HttpStatusCode.OK, await publish.Content.ReadAsStringAsync());

        var body = await publish.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("paper").GetProperty("status").GetString().ShouldBe("published");

        // 已发布后题位不可改。
        var add = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/items",
            new { questionId = _draftQuestionId, score = 5m });
        add.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);

        var problem = await add.Content.ReadFromJsonAsync<JsonElement>();
        problem.GetProperty("errorCode").GetInt32().ShouldBe(24101);
    }

    [Fact]
    public async Task 已发布试卷不能删除_撤回后可删()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync(totalScore: 10m);
        await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/items",
            new { questionId = _publishedQuestionId, score = 10m });
        await _client.PostAsync($"/api/v1/papers/{paperId}/publish", null);

        var delete = await _client.DeleteAsync($"/api/v1/papers/{paperId}");
        delete.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);

        var unpublish = await _client.PostAsync($"/api/v1/papers/{paperId}/unpublish", null);
        unpublish.StatusCode.ShouldBe(HttpStatusCode.OK);

        var deleteAfter = await _client.DeleteAsync($"/api/v1/papers/{paperId}");
        deleteAfter.StatusCode.ShouldBe(HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task 发布_警告项需填写覆盖理由()
    {
        await LoginAsync();

        // 90 分钟只有一道题：题均时长超出建议区间，属于警告项。
        var paperId = await CreatePaperAsync(totalScore: 10m, durationMinutes: 90);
        await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/items",
            new { questionId = _publishedQuestionId, score = 10m });

        var withoutReason = await _client.PostAsync($"/api/v1/papers/{paperId}/publish", null);
        withoutReason.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);

        var problem = await withoutReason.Content.ReadFromJsonAsync<JsonElement>();
        problem.GetProperty("title").GetString()!.ShouldContain("警告");

        var withReason = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/publish",
            new { warningOverrideReason = "本次为专项测验，时长放宽" });
        withReason.StatusCode.ShouldBe(HttpStatusCode.OK, await withReason.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task 整体替换题位集合()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync(totalScore: 10m);

        var replace = await _client.PutAsJsonAsync(
            $"/api/v1/papers/{paperId}/items",
            new { items = new[] { new { questionId = _publishedQuestionId, score = 10m } } });

        replace.StatusCode.ShouldBe(HttpStatusCode.OK, await replace.Content.ReadAsStringAsync());

        var body = await replace.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("items").GetArrayLength().ShouldBe(1);
    }

    [Fact]
    public async Task 试卷列表按形态与状态过滤()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync(totalScore: 10m);

        var list = await _client.GetAsync("/api/v1/papers?kind=exam&status=draft");
        list.StatusCode.ShouldBe(HttpStatusCode.OK);

        var body = await list.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("total").GetInt32().ShouldBeGreaterThan(0);

        var detail = await _client.GetAsync($"/api/v1/papers/{paperId}");
        detail.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    private async Task<long> CreatePaperAsync(decimal totalScore, int durationMinutes = 15)
    {
        var response = await _client.PostAsJsonAsync(
            "/api/v1/papers",
            new
            {
                kind = "exam",
                name = "计算机网络期中考试",
                targetTotalScore = totalScore,
                durationMinutes = durationMinutes,
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

    private static async Task<long> SeedQuestionAsync(AppDbContext db, string code, bool publish)
    {
        var now = DateTimeOffset.UtcNow;
        var question = Question.CreateDraft(code, QuestionType.Single, "题干", Score.Question(5), 1, now);
        question.AddOption(QuestionOption.Create("A", "甲", true, 0), now);
        question.AddOption(QuestionOption.Create("B", "乙", false, 1), now);

        await db.Questions.AddAsync(question);
        await db.SaveChangesAsync();

        if (publish)
        {
            question.Publish(now);
            await db.SaveChangesAsync();
        }

        return question.Id;
    }

    private static async Task<long> SeedRoleAsync(AppDbContext db)
    {
        var now = DateTimeOffset.UtcNow;
        var role = Role.Create("paper_admin", "试卷管理员", now);
        await db.Roles.AddAsync(role);
        await db.SaveChangesAsync();

        string[] codes =
        [
            PermissionCatalog.PaperRead,
            PermissionCatalog.PaperWrite,
            PermissionCatalog.PaperPublish,
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

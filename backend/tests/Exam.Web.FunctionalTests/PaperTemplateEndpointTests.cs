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

/// <summary>卷型模板的端到端测试。</summary>
public sealed class PaperTemplateEndpointTests : IAsyncLifetime
{
    private const string AdminUsername = "tmpladmin1";
    private const string AdminPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _questionId;

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

        _questionId = await SeedQuestionAsync(db, "Q-TPL-001");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 由试卷另存为模板()
    {
        await LoginAsync();

        var paperId = await CreatePaperWithItemAsync();

        var create = await _client.PostAsJsonAsync(
            "/api/v1/paper-templates",
            new { paperId, name = "期中模板" });
        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var body = await create.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("template").GetProperty("name").GetString().ShouldBe("期中模板");
        body.GetProperty("template").GetProperty("itemCount").GetInt32().ShouldBe(1);
        body.GetProperty("template").GetProperty("kind").GetString().ShouldBe("exam");
        body.GetProperty("items").GetArrayLength().ShouldBe(1);

        var list = await _client.GetAsync("/api/v1/paper-templates");
        list.StatusCode.ShouldBe(HttpStatusCode.OK);
        var listBody = await list.Content.ReadFromJsonAsync<JsonElement>();
        listBody.GetProperty("total").GetInt32().ShouldBe(1);
    }

    [Fact]
    public async Task 套用模板会替换目标试卷题位()
    {
        await LoginAsync();

        var sourceId = await CreatePaperWithItemAsync();
        var templateId = await CreateTemplateAsync(sourceId, "期中模板");

        var targetId = await CreatePaperWithItemAsync();

        var apply = await _client.PostAsJsonAsync(
            $"/api/v1/paper-templates/{templateId}/apply",
            new { paperId = targetId });
        apply.StatusCode.ShouldBe(HttpStatusCode.OK, await apply.Content.ReadAsStringAsync());

        var body = await apply.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("appliedCount").GetInt32().ShouldBe(1);
        body.GetProperty("skippedCount").GetInt32().ShouldBe(0);
        body.GetProperty("totalScore").GetDecimal().ShouldBe(10m);
        body.GetProperty("paper").GetProperty("items").GetArrayLength().ShouldBe(1);
    }

    [Fact]
    public async Task 题目已停用时套用模板会报告跳过清单()
    {
        await LoginAsync();

        var sourceId = await CreatePaperWithItemAsync();
        var templateId = await CreateTemplateAsync(sourceId, "期中模板");

        var targetId = await CreatePaperWithItemAsync();

        // 把模板里的题目停用。
        await SetQuestionStatusAsync(QuestionStatus.Disabled);

        var apply = await _client.PostAsJsonAsync(
            $"/api/v1/paper-templates/{templateId}/apply",
            new { paperId = targetId });
        apply.StatusCode.ShouldBe(HttpStatusCode.OK, await apply.Content.ReadAsStringAsync());

        var body = await apply.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("appliedCount").GetInt32().ShouldBe(0);
        body.GetProperty("skippedCount").GetInt32().ShouldBe(1);

        var skipped = body.GetProperty("skipped")[0];
        skipped.GetProperty("questionId").GetInt64().ShouldBe(_questionId);
        skipped.GetProperty("code").GetString().ShouldBe("Q-TPL-001");
        skipped.GetProperty("reason").GetString().ShouldBe("题目已停用");
    }

    [Fact]
    public async Task 形态不一致的模板不能套用()
    {
        await LoginAsync();

        var sourceId = await CreatePaperWithItemAsync();
        var templateId = await CreateTemplateAsync(sourceId, "期中模板");

        var practice = await _client.PostAsJsonAsync(
            "/api/v1/papers",
            new
            {
                kind = "practice",
                name = "计算机网络专项练习",
                targetTotalScore = 10,
                durationMinutes = 15,
            });
        practice.StatusCode.ShouldBe(HttpStatusCode.OK, await practice.Content.ReadAsStringAsync());
        var practiceBody = await practice.Content.ReadFromJsonAsync<JsonElement>();
        var practiceId = practiceBody.GetProperty("paper").GetProperty("id").GetInt64();

        var apply = await _client.PostAsJsonAsync(
            $"/api/v1/paper-templates/{templateId}/apply",
            new { paperId = practiceId });
        apply.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
    }

    private async Task<long> CreateTemplateAsync(long paperId, string name)
    {
        var create = await _client.PostAsJsonAsync(
            "/api/v1/paper-templates",
            new { paperId, name });
        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var body = await create.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("template").GetProperty("id").GetInt64();
    }

    private async Task SetQuestionStatusAsync(QuestionStatus status)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var question = await db.Questions
            .Include(q => q.Options)
            .Include(q => q.Keypoints)
            .Include(q => q.Steps)
            .Include(q => q.Attachments)
            .FirstAsync(q => q.Id == _questionId);

        if (status == QuestionStatus.Disabled)
        {
            question.Disable(DateTimeOffset.UtcNow);
        }
        else
        {
            question.Publish(DateTimeOffset.UtcNow);
        }

        await db.SaveChangesAsync();
    }

    private async Task<long> CreatePaperWithItemAsync()
    {
        var create = await _client.PostAsJsonAsync(
            "/api/v1/papers",
            new
            {
                kind = "exam",
                name = "计算机网络期中考试",
                targetTotalScore = 10,
                durationMinutes = 15,
            });
        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var body = await create.Content.ReadFromJsonAsync<JsonElement>();
        var paperId = body.GetProperty("paper").GetProperty("id").GetInt64();

        var add = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/items",
            new { questionId = _questionId, score = 10m });
        add.StatusCode.ShouldBe(HttpStatusCode.OK, await add.Content.ReadAsStringAsync());

        return paperId;
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

    private static async Task<long> SeedQuestionAsync(AppDbContext db, string code)
    {
        var now = DateTimeOffset.UtcNow;
        var question = Question.CreateDraft(code, QuestionType.Single, "题干", Score.Question(10), 1, now);
        question.AddOption(QuestionOption.Create("A", "甲", true, 0), now);
        question.AddOption(QuestionOption.Create("B", "乙", false, 1), now);

        await db.Questions.AddAsync(question);
        await db.SaveChangesAsync();

        question.Publish(now);
        await db.SaveChangesAsync();

        return question.Id;
    }

    private static async Task<long> SeedRoleAsync(AppDbContext db)
    {
        var now = DateTimeOffset.UtcNow;
        var role = Role.Create("template_admin", "模板管理员", now);
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

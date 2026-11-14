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

/// <summary>试卷快照的端到端测试：发布即冻结，改题不影响已发布卷面。</summary>
public sealed class PaperSnapshotEndpointTests : IAsyncLifetime
{
    private const string AdminUsername = "snapadmin1";
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

        _questionId = await SeedQuestionAsync(db, "Q-SNAP-001", "原始题干");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 发布试卷生成第一版快照()
    {
        await LoginAsync();

        var paperId = await CreatePublishedPaperAsync();

        var list = await _client.GetAsync($"/api/v1/papers/{paperId}/snapshots");
        list.StatusCode.ShouldBe(HttpStatusCode.OK, await list.Content.ReadAsStringAsync());

        var body = await list.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("total").GetInt32().ShouldBe(1);

        var summary = body.GetProperty("items")[0];
        summary.GetProperty("version").GetInt32().ShouldBe(1);
        summary.GetProperty("itemCount").GetInt32().ShouldBe(1);
        summary.GetProperty("totalScore").GetDecimal().ShouldBe(10m);
        summary.GetProperty("contentHash").GetString().ShouldNotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task 快照内容包含题目正文与正确答案()
    {
        await LoginAsync();

        var paperId = await CreatePublishedPaperAsync();

        var latest = await _client.GetAsync($"/api/v1/papers/{paperId}/snapshots/latest");
        latest.StatusCode.ShouldBe(HttpStatusCode.OK, await latest.Content.ReadAsStringAsync());

        var body = await latest.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("version").GetInt32().ShouldBe(1);

        var item = body.GetProperty("items")[0];
        item.GetProperty("stem").GetString().ShouldBe("原始题干");
        item.GetProperty("questionCode").GetString().ShouldBe("Q-SNAP-001");
        item.GetProperty("score").GetDecimal().ShouldBe(10m);
        item.GetProperty("correctKeys")[0].GetString().ShouldBe("A");
    }

    [Fact]
    public async Task 发布后修改题目_已发布快照内容不变()
    {
        await LoginAsync();

        var paperId = await CreatePublishedPaperAsync();

        // 直接改题目，模拟出题教师在发布后修订了题干。
        await MutateQuestionStemAsync("改过的题干");

        var latest = await _client.GetAsync($"/api/v1/papers/{paperId}/snapshots/latest");
        latest.StatusCode.ShouldBe(HttpStatusCode.OK);

        var body = await latest.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("items")[0].GetProperty("stem").GetString().ShouldBe("原始题干");

        // 题目本身确实已经被改了。
        var questions = await _client.GetAsync($"/api/v1/questions/{_questionId}");
        questions.StatusCode.ShouldBe(HttpStatusCode.OK);
        var questionBody = await questions.Content.ReadFromJsonAsync<JsonElement>();
        questionBody.GetProperty("question").GetProperty("stem").GetString().ShouldBe("改过的题干");
    }

    [Fact]
    public async Task 撤回再发布生成新版本快照()
    {
        await LoginAsync();

        var paperId = await CreatePublishedPaperAsync();

        var unpublish = await _client.PostAsync($"/api/v1/papers/{paperId}/unpublish", null);
        unpublish.StatusCode.ShouldBe(HttpStatusCode.OK, await unpublish.Content.ReadAsStringAsync());

        var republish = await _client.PostAsync($"/api/v1/papers/{paperId}/publish", null);
        republish.StatusCode.ShouldBe(HttpStatusCode.OK, await republish.Content.ReadAsStringAsync());

        var body = await republish.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("paper").GetProperty("status").GetString().ShouldBe("published");

        var list = await _client.GetAsync($"/api/v1/papers/{paperId}/snapshots");
        list.StatusCode.ShouldBe(HttpStatusCode.OK);

        var listBody = await list.Content.ReadFromJsonAsync<JsonElement>();
        listBody.GetProperty("total").GetInt32().ShouldBe(2);

        var items = listBody.GetProperty("items");
        items[0].GetProperty("version").GetInt32().ShouldBe(2);
        items[1].GetProperty("version").GetInt32().ShouldBe(1);
    }

    [Fact]
    public async Task 可以按版本取回历史快照()
    {
        await LoginAsync();

        var paperId = await CreatePublishedPaperAsync();

        var unpublish = await _client.PostAsync($"/api/v1/papers/{paperId}/unpublish", null);
        unpublish.StatusCode.ShouldBe(HttpStatusCode.OK);

        await MutateQuestionStemAsync("第二次改的题干");

        var republish = await _client.PostAsync($"/api/v1/papers/{paperId}/publish", null);
        republish.StatusCode.ShouldBe(HttpStatusCode.OK, await republish.Content.ReadAsStringAsync());

        var v1 = await _client.GetAsync($"/api/v1/papers/{paperId}/snapshots/1");
        v1.StatusCode.ShouldBe(HttpStatusCode.OK, await v1.Content.ReadAsStringAsync());

        var v1Body = await v1.Content.ReadFromJsonAsync<JsonElement>();
        v1Body.GetProperty("version").GetInt32().ShouldBe(1);
        v1Body.GetProperty("items")[0].GetProperty("stem").GetString().ShouldBe("原始题干");

        var v2 = await _client.GetAsync($"/api/v1/papers/{paperId}/snapshots/2");
        v2.StatusCode.ShouldBe(HttpStatusCode.OK);

        var v2Body = await v2.Content.ReadFromJsonAsync<JsonElement>();
        v2Body.GetProperty("version").GetInt32().ShouldBe(2);
        v2Body.GetProperty("items")[0].GetProperty("stem").GetString().ShouldBe("第二次改的题干");
    }

    [Fact]
    public async Task 取回不存在的快照版本返回404()
    {
        await LoginAsync();

        var paperId = await CreatePublishedPaperAsync();

        var missing = await _client.GetAsync($"/api/v1/papers/{paperId}/snapshots/99");
        missing.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    private async Task<long> CreatePublishedPaperAsync()
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

        var publish = await _client.PostAsync($"/api/v1/papers/{paperId}/publish", null);
        publish.StatusCode.ShouldBe(HttpStatusCode.OK, await publish.Content.ReadAsStringAsync());

        return paperId;
    }

    private async Task MutateQuestionStemAsync(string stem)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var question = await db.Questions
            .Include(q => q.Options)
            .Include(q => q.Keypoints)
            .Include(q => q.Steps)
            .Include(q => q.Attachments)
            .FirstAsync(q => q.Id == _questionId);

        question.UpdateContent(stem, null, null, Score.Question(10), DateTimeOffset.UtcNow);
        await db.SaveChangesAsync();
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

    private static async Task<long> SeedQuestionAsync(AppDbContext db, string code, string stem)
    {
        var now = DateTimeOffset.UtcNow;
        var question = Question.CreateDraft(code, QuestionType.Single, stem, Score.Question(10), 1, now);
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
        var role = Role.Create("snapshot_admin", "快照管理员", now);
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

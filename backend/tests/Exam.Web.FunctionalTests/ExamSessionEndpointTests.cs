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

/// <summary>考试场次的端到端测试。</summary>
public sealed class ExamSessionEndpointTests : IAsyncLifetime
{
    private const string AdminUsername = "sessionadmin1";
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

        _questionId = await SeedQuestionAsync(db, "Q-SES-001");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 新建场次默认未发布()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync();

        var create = await _client.PostAsJsonAsync(
            "/api/v1/exam-sessions",
            new
            {
                paperId,
                name = "计算机网络期中考试",
                openAt = DateTimeOffset.UtcNow.AddMinutes(-5),
                closeAt = DateTimeOffset.UtcNow.AddHours(4),
                durationMinutes = 90,
                participantMode = "open",
                variantRule = "small_plum",
            });

        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var body = await create.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("session").GetProperty("status").GetString().ShouldBe("scheduled");
        body.GetProperty("session").GetProperty("participantMode").GetString().ShouldBe("open");
        body.GetProperty("session").GetProperty("variantRule").GetString().ShouldBe("small_plum");
        body.GetProperty("snapshotId").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task 试卷没发布时不能发布场次()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync();
        var sessionId = await CreateSessionAsync(paperId);

        var publish = await _client.PostAsync($"/api/v1/exam-sessions/{sessionId}/publish", null);
        publish.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task 发布场次后绑定试卷快照并进入进行中()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync(publishPaper: true);
        var sessionId = await CreateSessionAsync(paperId);

        var publish = await _client.PostAsync($"/api/v1/exam-sessions/{sessionId}/publish", null);
        publish.StatusCode.ShouldBe(HttpStatusCode.OK, await publish.Content.ReadAsStringAsync());

        var body = await publish.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("session").GetProperty("status").GetString().ShouldBe("in_progress");
        body.GetProperty("snapshotId").GetInt64().ShouldBeGreaterThan(0);
    }

    [Fact]
    public async Task 已发布的场次不能改配置()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync(publishPaper: true);
        var sessionId = await CreateSessionAsync(paperId);
        await _client.PostAsync($"/api/v1/exam-sessions/{sessionId}/publish", null);

        var update = await _client.PutAsJsonAsync(
            $"/api/v1/exam-sessions/{sessionId}",
            new
            {
                name = "改名字",
                openAt = DateTimeOffset.UtcNow.AddMinutes(-5),
                closeAt = DateTimeOffset.UtcNow.AddHours(4),
                durationMinutes = 60,
                participantMode = "open",
            });

        update.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task 关闭场次后不能再次关闭()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync(publishPaper: true);
        var sessionId = await CreateSessionAsync(paperId);
        await _client.PostAsync($"/api/v1/exam-sessions/{sessionId}/publish", null);

        var close = await _client.PostAsync($"/api/v1/exam-sessions/{sessionId}/close", null);
        close.StatusCode.ShouldBe(HttpStatusCode.OK, await close.Content.ReadAsStringAsync());

        var body = await close.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("session").GetProperty("status").GetString().ShouldBe("closed");

        var again = await _client.PostAsync($"/api/v1/exam-sessions/{sessionId}/close", null);
        again.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task 取消场次()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync(publishPaper: true);
        var sessionId = await CreateSessionAsync(paperId);
        await _client.PostAsync($"/api/v1/exam-sessions/{sessionId}/publish", null);

        var cancel = await _client.PostAsync($"/api/v1/exam-sessions/{sessionId}/cancel", null);
        cancel.StatusCode.ShouldBe(HttpStatusCode.OK, await cancel.Content.ReadAsStringAsync());

        var body = await cancel.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("session").GetProperty("status").GetString().ShouldBe("cancelled");
    }

    [Fact]
    public async Task 场次列表可按状态过滤()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync(publishPaper: true);
        await CreateSessionAsync(paperId);

        var list = await _client.GetAsync("/api/v1/exam-sessions?status=scheduled");
        list.StatusCode.ShouldBe(HttpStatusCode.OK);

        var body = await list.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("total").GetInt32().ShouldBe(1);
        body.GetProperty("items")[0].GetProperty("paperName").GetString().ShouldBe("计算机网络期中考试");
    }

    [Fact]
    public async Task 时间窗不合法时拒绝新建()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync();

        var create = await _client.PostAsJsonAsync(
            "/api/v1/exam-sessions",
            new
            {
                paperId,
                name = "计算机网络期中考试",
                openAt = DateTimeOffset.UtcNow.AddHours(4),
                closeAt = DateTimeOffset.UtcNow,
                durationMinutes = 90,
                participantMode = "open",
            });

        create.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    private async Task<long> CreateSessionAsync(long paperId)
    {
        var create = await _client.PostAsJsonAsync(
            "/api/v1/exam-sessions",
            new
            {
                paperId,
                name = "计算机网络期中考试",
                openAt = DateTimeOffset.UtcNow.AddMinutes(-5),
                closeAt = DateTimeOffset.UtcNow.AddHours(4),
                durationMinutes = 90,
                participantMode = "open",
            });
        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var body = await create.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("session").GetProperty("id").GetInt64();
    }

    private async Task<long> CreatePaperAsync(bool publishPaper = false)
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

        if (publishPaper)
        {
            var publish = await _client.PostAsync($"/api/v1/papers/{paperId}/publish", null);
            publish.StatusCode.ShouldBe(HttpStatusCode.OK, await publish.Content.ReadAsStringAsync());
        }

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
        var role = Role.Create("session_admin", "场次管理员", now);
        await db.Roles.AddAsync(role);
        await db.SaveChangesAsync();

        string[] codes =
        [
            PermissionCatalog.ExamRead,
            PermissionCatalog.ExamWrite,
            PermissionCatalog.ExamPublish,
            PermissionCatalog.PaperRead,
            PermissionCatalog.PaperWrite,
            PermissionCatalog.PaperPublish,
            PermissionCatalog.QuestionRead,
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

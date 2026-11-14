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

/// <summary>交卷自动评分的端到端测试：客观题定分，主观题给建议分。</summary>
public sealed class AttemptScoringTests : IAsyncLifetime
{
    private const string TeacherUsername = "scoreteacher1";
    private const string TeacherPassword = "Passw0rd!";
    private const string StudentUsername = "scorestudent1";
    private const string StudentPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _singleQuestionId;
    private long _shortQuestionId;

    public async Task InitializeAsync()
    {
        await _postgres.StartAsync();

        _factory = new ExamWebFactory(_postgres.GetConnectionString());
        _client = _factory.CreateClient();
        _client.BaseAddress = new Uri("http://localhost");

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.MigrateAsync();

        var teacherRoleId = await SeedRoleAsync(db, "score_teacher", PermissionCatalog.ExamRead, PermissionCatalog.ExamWrite, PermissionCatalog.ExamPublish, PermissionCatalog.PaperRead, PermissionCatalog.PaperWrite, PermissionCatalog.PaperPublish, PermissionCatalog.QuestionRead, PermissionCatalog.QuestionPublish, PermissionCatalog.TagRead);
        await SeedUserAsync(db, TeacherUsername, TeacherPassword, teacherRoleId);

        var studentRoleId = await SeedRoleAsync(db, "score_student", PermissionCatalog.AttemptTake, PermissionCatalog.AttemptReadOwn);
        await SeedUserAsync(db, StudentUsername, StudentPassword, studentRoleId);

        _singleQuestionId = await SeedSingleQuestionAsync(db, "Q-SCO-001");
        _shortQuestionId = await SeedShortQuestionAsync(db, "Q-SCO-002");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 客观题答对自动得满分()
    {
        var attemptId = await StartAttemptAsync();

        await SaveAnswerAsync(attemptId, 1, new { selectedOptionKeys = new[] { "A" } });

        var submit = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/submit",
            new { reason = "manual" });
        submit.StatusCode.ShouldBe(HttpStatusCode.OK, await submit.Content.ReadAsStringAsync());

        var body = await submit.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("objectiveScore").GetDecimal().ShouldBe(10m);
        body.GetProperty("objectiveMax").GetDecimal().ShouldBe(10m);
        body.GetProperty("totalScore").GetDecimal().ShouldBe(10m);
        body.GetProperty("totalMax").GetDecimal().ShouldBe(20m);

        // 主观题还没作答，也还没定分 → 整份成绩仍是「待阅」。
        body.GetProperty("subjectivePending").GetBoolean().ShouldBeTrue();
        body.GetProperty("gradeVisibility").GetString().ShouldBe("pending_review");
    }

    [Fact]
    public async Task 客观题答错自动得零分()
    {
        var attemptId = await StartAttemptAsync();

        await SaveAnswerAsync(attemptId, 1, new { selectedOptionKeys = new[] { "B" } });

        var submit = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/submit",
            new { reason = "manual" });
        submit.StatusCode.ShouldBe(HttpStatusCode.OK, await submit.Content.ReadAsStringAsync());

        var body = await submit.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("objectiveScore").GetDecimal().ShouldBe(0m);
        body.GetProperty("objectiveMax").GetDecimal().ShouldBe(10m);
    }

    [Fact]
    public async Task 主观题产出建议分并标记待阅()
    {
        var attemptId = await StartAttemptAsync();

        await SaveAnswerAsync(attemptId, 2, new { text = "TCP 三次握手可以建立连接" });

        var submit = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/submit",
            new { reason = "manual" });
        submit.StatusCode.ShouldBe(HttpStatusCode.OK, await submit.Content.ReadAsStringAsync());

        var body = await submit.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("subjectivePending").GetBoolean().ShouldBeTrue();
        body.GetProperty("gradeVisibility").GetString().ShouldBe("pending_review");

        // 命中一个要点（共两个）→ 建议分一半。
        body.GetProperty("totalScore").GetDecimal().ShouldBe(5m);
        body.GetProperty("totalMax").GetDecimal().ShouldBe(20m);
    }

    [Fact]
    public async Task 交卷后可查逐题成绩()
    {
        var attemptId = await StartAttemptAsync();

        await SaveAnswerAsync(attemptId, 1, new { selectedOptionKeys = new[] { "A" } });

        await _client.PostAsJsonAsync($"/api/v1/attempts/{attemptId}/submit", new { reason = "manual" });

        var scores = await _client.GetAsync($"/api/v1/attempts/{attemptId}/scores");
        scores.StatusCode.ShouldBe(HttpStatusCode.OK, await scores.Content.ReadAsStringAsync());

        var body = await scores.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("totalScore").GetDecimal().ShouldBe(10m);
        body.GetProperty("totalMax").GetDecimal().ShouldBe(20m);

        var items = body.GetProperty("items");
        items.GetArrayLength().ShouldBe(2);

        var objective = items.EnumerateArray().First(i => i.GetProperty("questionId").GetInt64() == _singleQuestionId);
        objective.GetProperty("status").GetString().ShouldBe("auto_scored");
        objective.GetProperty("score").GetDecimal().ShouldBe(10m);

        var subjective = items.EnumerateArray().First(i => i.GetProperty("questionId").GetInt64() == _shortQuestionId);
        subjective.GetProperty("status").GetString().ShouldBe("suggested");
        subjective.GetProperty("method").GetString().ShouldBe("auto_suggested");

        // 主观题没作答：两个要点都没命中。
        subjective.GetProperty("hitItems").GetArrayLength().ShouldBe(0);
        subjective.GetProperty("missedItems").GetArrayLength().ShouldBe(2);
    }

    private async Task SaveAnswerAsync(long attemptId, long questionId, object payload)
    {
        var save = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/answers",
            new { clientSeq = 1, items = new[] { new { questionId, payload } } });

        save.StatusCode.ShouldBe(HttpStatusCode.OK, await save.Content.ReadAsStringAsync());
    }

    private async Task<long> StartAttemptAsync()
    {
        await LoginAsync(TeacherUsername, TeacherPassword);
        var sessionId = await CreateSessionAsync();

        await LoginAsync(StudentUsername, StudentPassword);

        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { examSessionId = sessionId });
        start.StatusCode.ShouldBe(HttpStatusCode.OK, await start.Content.ReadAsStringAsync());

        var body = await start.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("attemptId").GetInt64();
    }

    private async Task<long> CreateSessionAsync()
    {
        var create = await _client.PostAsJsonAsync(
            "/api/v1/papers",
            new
            {
                kind = "exam",
                name = "计算机网络期中考试",
                targetTotalScore = 20,
                durationMinutes = 15,
            });
        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var paperBody = await create.Content.ReadFromJsonAsync<JsonElement>();
        var paperId = paperBody.GetProperty("paper").GetProperty("id").GetInt64();

        foreach (var questionId in new[] { _singleQuestionId, _shortQuestionId })
        {
            var add = await _client.PostAsJsonAsync(
                $"/api/v1/papers/{paperId}/items",
                new { questionId, score = 10m });
            add.StatusCode.ShouldBe(HttpStatusCode.OK, await add.Content.ReadAsStringAsync());
        }

        // 试卷含主观题，主观题占比超建议值，发布时给出覆盖理由。
        var publishPaper = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/publish",
            new { warningOverrideReason = "本次含主观题，用于验证自动评分" });
        publishPaper.StatusCode.ShouldBe(HttpStatusCode.OK, await publishPaper.Content.ReadAsStringAsync());

        var session = await _client.PostAsJsonAsync(
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
        session.StatusCode.ShouldBe(HttpStatusCode.OK, await session.Content.ReadAsStringAsync());

        var sessionBody = await session.Content.ReadFromJsonAsync<JsonElement>();
        var sessionId = sessionBody.GetProperty("session").GetProperty("id").GetInt64();

        var publish = await _client.PostAsync($"/api/v1/exam-sessions/{sessionId}/publish", null);
        publish.StatusCode.ShouldBe(HttpStatusCode.OK, await publish.Content.ReadAsStringAsync());

        return sessionId;
    }

    private async Task LoginAsync(string username, string password)
    {
        var response = await _client.PostAsJsonAsync("/api/v1/auth/login", new { username, password });
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        _client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", body.GetProperty("accessToken").GetString());
    }

    private static async Task<long> SeedSingleQuestionAsync(AppDbContext db, string code)
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

    private static async Task<long> SeedShortQuestionAsync(AppDbContext db, string code)
    {
        var now = DateTimeOffset.UtcNow;
        var question = Question.CreateDraft(code, QuestionType.Short, "题干", Score.Question(10), 1, now);
        question.AddKeypoint(QuestionKeypoint.Create("三次握手", ["三次", "握手"], 0), now);
        question.AddKeypoint(QuestionKeypoint.Create("四次挥手", ["四次", "挥手"], 1), now);

        await db.Questions.AddAsync(question);
        await db.SaveChangesAsync();

        question.Publish(now);
        await db.SaveChangesAsync();

        return question.Id;
    }

    private static async Task<long> SeedRoleAsync(AppDbContext db, string code, params string[] permissions)
    {
        var now = DateTimeOffset.UtcNow;
        var role = Role.Create(code, code, now);
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

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Exam.Application.Messaging;
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
/// 单题重做：把错题做成一份只有一道题的练习，答对之后移出错题本。
/// </summary>
public sealed class MistakeRedoTests : IAsyncLifetime
{
    private const string TeacherUsername = "redoteacher1";
    private const string TeacherPassword = "Passw0rd!";
    private const string StudentUsername = "redostudent1";
    private const string StudentPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _singleQuestionId;
    private long _sessionId;

    public async Task InitializeAsync()
    {
        await _postgres.StartAsync();

        _factory = new ExamWebFactory(_postgres.GetConnectionString());
        _client = _factory.CreateClient();
        _client.BaseAddress = new Uri("http://localhost");

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.MigrateAsync();

        var teacherRoleId = await SeedRoleAsync(
            db,
            "redo_teacher",
            PermissionCatalog.ExamRead,
            PermissionCatalog.ExamWrite,
            PermissionCatalog.ExamPublish,
            PermissionCatalog.PaperRead,
            PermissionCatalog.PaperWrite,
            PermissionCatalog.PaperPublish,
            PermissionCatalog.QuestionRead,
            PermissionCatalog.QuestionPublish,
            PermissionCatalog.TagRead,
            PermissionCatalog.ReviewGrade,
            PermissionCatalog.GradePublish);

        await SeedUserAsync(db, TeacherUsername, TeacherPassword, teacherRoleId);

        var studentRoleId = await SeedRoleAsync(db, "redo_student", PermissionCatalog.AttemptTake, PermissionCatalog.AttemptReadOwn);
        await SeedUserAsync(db, StudentUsername, StudentPassword, studentRoleId);

        _singleQuestionId = await SeedSingleQuestionAsync(db, "Q-RDO-001");
        _sessionId = await CreateSessionAsync();
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 重做生成一份只有一道题的练习()
    {
        await MakeMistakeAsync();

        await LoginAsync(StudentUsername, StudentPassword);
        var redo = await _client.PostAsync($"/api/v1/mistakes/{_singleQuestionId}/redo", null);
        redo.StatusCode.ShouldBe(HttpStatusCode.OK, await redo.Content.ReadAsStringAsync());

        var body = await redo.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("questionId").GetInt64().ShouldBe(_singleQuestionId);
        body.GetProperty("questionCode").GetString().ShouldBe("Q-RDO-001");
        body.GetProperty("practiceAssignmentId").GetInt64().ShouldBeGreaterThan(0);
        var attemptId = body.GetProperty("attemptId").GetInt64();
        attemptId.ShouldBeGreaterThan(0);

        // 会话里就是那一道题。
        var attempt = await _client.GetAsync($"/api/v1/attempts/{attemptId}");
        attempt.StatusCode.ShouldBe(HttpStatusCode.OK, await attempt.Content.ReadAsStringAsync());

        var attemptBody = await attempt.Content.ReadFromJsonAsync<JsonElement>();
        attemptBody.GetProperty("targetType").GetString().ShouldBe("practice");
        var questions = attemptBody.GetProperty("questions").EnumerateArray().ToList();
        questions.Count.ShouldBe(1);
        questions[0].GetProperty("questionId").GetInt64().ShouldBe(_singleQuestionId);
    }

    [Fact]
    public async Task 重做答对之后移出错题本()
    {
        await MakeMistakeAsync();

        await LoginAsync(StudentUsername, StudentPassword);
        var redo = await _client.PostAsync($"/api/v1/mistakes/{_singleQuestionId}/redo", null);
        redo.StatusCode.ShouldBe(HttpStatusCode.OK, await redo.Content.ReadAsStringAsync());

        var body = await redo.Content.ReadFromJsonAsync<JsonElement>();
        var attemptId = body.GetProperty("attemptId").GetInt64();

        // 这次答对。
        var save = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/answers",
            new { clientSeq = 1, items = new[] { new { questionId = _singleQuestionId, payload = new { selectedOptionKeys = new[] { "A" } } } } });
        save.StatusCode.ShouldBe(HttpStatusCode.OK, await save.Content.ReadAsStringAsync());

        var submit = await _client.PostAsJsonAsync($"/api/v1/attempts/{attemptId}/submit", new { reason = "manual" });
        submit.StatusCode.ShouldBe(HttpStatusCode.OK, await submit.Content.ReadAsStringAsync());

        await DispatchAsync();

        // 错题本里没有了。
        var list = await _client.GetAsync("/api/v1/mistakes");
        var listBody = await list.Content.ReadFromJsonAsync<JsonElement>();
        listBody.GetProperty("total").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task 不在错题本里的题不能重做()
    {
        await LoginAsync(StudentUsername, StudentPassword);
        var redo = await _client.PostAsync($"/api/v1/mistakes/{_singleQuestionId}/redo", null);

        redo.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    /// <summary>做错一道题，让它进错题本。</summary>
    private async Task MakeMistakeAsync()
    {
        await LoginAsync(StudentUsername, StudentPassword);

        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { examSessionId = _sessionId });
        start.StatusCode.ShouldBe(HttpStatusCode.OK, await start.Content.ReadAsStringAsync());

        var startBody = await start.Content.ReadFromJsonAsync<JsonElement>();
        var attemptId = startBody.GetProperty("attemptId").GetInt64();

        var save = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/answers",
            new { clientSeq = 1, items = new[] { new { questionId = _singleQuestionId, payload = new { selectedOptionKeys = new[] { "B" } } } } });
        save.StatusCode.ShouldBe(HttpStatusCode.OK, await save.Content.ReadAsStringAsync());

        var submit = await _client.PostAsJsonAsync($"/api/v1/attempts/{attemptId}/submit", new { reason = "manual" });
        submit.StatusCode.ShouldBe(HttpStatusCode.OK, await submit.Content.ReadAsStringAsync());

        await DispatchAsync();

        var list = await _client.GetAsync("/api/v1/mistakes");
        var listBody = await list.Content.ReadFromJsonAsync<JsonElement>();
        listBody.GetProperty("total").GetInt32().ShouldBe(1, "错题应该已经进错题本。");
    }

    private async Task DispatchAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var dispatcher = scope.ServiceProvider.GetRequiredService<IDomainEventDispatcher>();
        await dispatcher.DispatchPendingAsync();
    }

    private async Task<long> CreateSessionAsync()
    {
        await LoginAsync(TeacherUsername, TeacherPassword);

        var create = await _client.PostAsJsonAsync(
            "/api/v1/papers",
            new
            {
                kind = "exam",
                name = "单题重做测试考试",
                targetTotalScore = 10,
                durationMinutes = 15,
            });
        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var paperBody = await create.Content.ReadFromJsonAsync<JsonElement>();
        var paperId = paperBody.GetProperty("paper").GetProperty("id").GetInt64();

        var add = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/items",
            new { questionId = _singleQuestionId, score = 10m });
        add.StatusCode.ShouldBe(HttpStatusCode.OK, await add.Content.ReadAsStringAsync());

        var publishPaper = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/publish",
            new { warningOverrideReason = "用于验证单题重做" });
        publishPaper.StatusCode.ShouldBe(HttpStatusCode.OK, await publishPaper.Content.ReadAsStringAsync());

        var session = await _client.PostAsJsonAsync(
            "/api/v1/exam-sessions",
            new
            {
                paperId,
                name = "单题重做测试考试",
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
        var question = Question.CreateDraft(code, QuestionType.Single, "单选题题干", Score.Question(10), 1, now);
        question.AddOption(QuestionOption.Create("A", "甲", true, 0), now);
        question.AddOption(QuestionOption.Create("B", "乙", false, 1), now);

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

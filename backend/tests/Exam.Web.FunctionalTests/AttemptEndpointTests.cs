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

/// <summary>作答会话的端到端测试：进入、幂等恢复、名单校验。</summary>
public sealed class AttemptEndpointTests : IAsyncLifetime
{
    private const string TeacherUsername = "attemptteacher1";
    private const string TeacherPassword = "Passw0rd!";
    private const string StudentUsername = "attemptstudent1";
    private const string StudentPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _questionId;
    private long _studentUserId;

    public async Task InitializeAsync()
    {
        await _postgres.StartAsync();

        _factory = new ExamWebFactory(_postgres.GetConnectionString());
        _client = _factory.CreateClient();
        _client.BaseAddress = new Uri("http://localhost");

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.MigrateAsync();

        var teacherRoleId = await SeedRoleAsync(db, "attempt_teacher", PermissionCatalog.ExamRead, PermissionCatalog.ExamWrite, PermissionCatalog.ExamPublish, PermissionCatalog.PaperRead, PermissionCatalog.PaperWrite, PermissionCatalog.PaperPublish, PermissionCatalog.QuestionRead, PermissionCatalog.QuestionPublish, PermissionCatalog.TagRead);
        await SeedUserAsync(db, TeacherUsername, TeacherPassword, teacherRoleId);

        var studentRoleId = await SeedRoleAsync(db, "attempt_student", PermissionCatalog.AttemptTake, PermissionCatalog.AttemptReadOwn);
        _studentUserId = await SeedUserAsync(db, StudentUsername, StudentPassword, studentRoleId);

        _questionId = await SeedQuestionAsync(db, "Q-ATT-001");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 进入考试下发卷面与服务端时间()
    {
        await LoginTeacherAsync();
        var sessionId = await CreateOpenSessionAsync();

        await LoginStudentAsync();

        var start = await _client.PostAsJsonAsync(
            "/api/v1/attempts",
            new { examSessionId = sessionId });
        start.StatusCode.ShouldBe(HttpStatusCode.OK, await start.Content.ReadAsStringAsync());

        var body = await start.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("attemptId").GetInt64().ShouldBeGreaterThan(0);
        body.GetProperty("attemptNo").GetInt32().ShouldBe(1);
        body.GetProperty("targetType").GetString().ShouldBe("exam");
        body.GetProperty("status").GetString().ShouldBe("in_progress");
        body.GetProperty("serverTime").GetDateTimeOffset().ShouldBeGreaterThan(DateTimeOffset.UtcNow.AddMinutes(-5));
        body.GetProperty("deadlineAt").GetDateTimeOffset().ShouldBeGreaterThan(DateTimeOffset.UtcNow);
        body.GetProperty("remainingSeconds").GetInt64().ShouldBeGreaterThan(0);
        body.GetProperty("variantKey").GetString().ShouldNotBeNullOrWhiteSpace();

        var questions = body.GetProperty("questions");
        questions.GetArrayLength().ShouldBe(1);
        var question = questions[0];
        question.GetProperty("code").GetString().ShouldBe("Q-ATT-001");
        question.GetProperty("stem").GetString().ShouldBe("题干");
        question.GetProperty("score").GetDecimal().ShouldBe(10m);
        question.GetProperty("options").GetArrayLength().ShouldBe(2);

        // 考试进行中绝不下发正确答案。
        question.TryGetProperty("correctKeys", out _).ShouldBeFalse();
    }

    [Fact]
    public async Task 重复进入返回同一个会话()
    {
        await LoginTeacherAsync();
        var sessionId = await CreateOpenSessionAsync();

        await LoginStudentAsync();

        var first = await _client.PostAsJsonAsync("/api/v1/attempts", new { examSessionId = sessionId });
        first.StatusCode.ShouldBe(HttpStatusCode.OK, await first.Content.ReadAsStringAsync());
        var firstBody = await first.Content.ReadFromJsonAsync<JsonElement>();

        var second = await _client.PostAsJsonAsync("/api/v1/attempts", new { examSessionId = sessionId });
        second.StatusCode.ShouldBe(HttpStatusCode.OK, await second.Content.ReadAsStringAsync());
        var secondBody = await second.Content.ReadFromJsonAsync<JsonElement>();

        secondBody.GetProperty("attemptId").GetInt64().ShouldBe(firstBody.GetProperty("attemptId").GetInt64());
        secondBody.GetProperty("attemptNo").GetInt32().ShouldBe(1);
    }

    [Fact]
    public async Task 恢复作答返回同一份卷面()
    {
        await LoginTeacherAsync();
        var sessionId = await CreateOpenSessionAsync();

        await LoginStudentAsync();

        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { examSessionId = sessionId });
        var startBody = await start.Content.ReadFromJsonAsync<JsonElement>();
        var attemptId = startBody.GetProperty("attemptId").GetInt64();

        var get = await _client.GetAsync($"/api/v1/attempts/{attemptId}");
        get.StatusCode.ShouldBe(HttpStatusCode.OK, await get.Content.ReadAsStringAsync());

        var body = await get.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("attemptId").GetInt64().ShouldBe(attemptId);
        body.GetProperty("questions").GetArrayLength().ShouldBe(1);
    }

    [Fact]
    public async Task 不在名单内的学生进不去()
    {
        await LoginTeacherAsync();
        var sessionId = await CreateSessionAsync("direct", new[] { 999999L });

        await LoginStudentAsync();

        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { examSessionId = sessionId });
        start.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task 名单内的学生可以进入()
    {
        await LoginTeacherAsync();
        var sessionId = await CreateSessionAsync("direct", new[] { _studentUserId });

        await LoginStudentAsync();

        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { examSessionId = sessionId });
        start.StatusCode.ShouldBe(HttpStatusCode.OK, await start.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task 场次未开放时不能进入()
    {
        await LoginTeacherAsync();
        var sessionId = await CreateSessionAsync("open", null, openAt: DateTimeOffset.UtcNow.AddHours(2));

        await LoginStudentAsync();

        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { examSessionId = sessionId });
        start.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task 我的会话列表能看到刚建的会话()
    {
        await LoginTeacherAsync();
        var sessionId = await CreateOpenSessionAsync();

        await LoginStudentAsync();
        await _client.PostAsJsonAsync("/api/v1/attempts", new { examSessionId = sessionId });

        var list = await _client.GetAsync("/api/v1/attempts");
        list.StatusCode.ShouldBe(HttpStatusCode.OK);

        var body = await list.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("total").GetInt32().ShouldBe(1);
        body.GetProperty("items")[0].GetProperty("status").GetString().ShouldBe("in_progress");
    }

    private async Task<long> CreateOpenSessionAsync() => await CreateSessionAsync("open", null);

    private async Task<long> CreateSessionAsync(
        string participantMode,
        long[]? participantUserIds,
        DateTimeOffset? openAt = null)
    {
        var paperId = await CreatePaperAsync();

        var create = await _client.PostAsJsonAsync(
            "/api/v1/exam-sessions",
            new
            {
                paperId,
                name = "计算机网络期中考试",
                openAt = openAt ?? DateTimeOffset.UtcNow.AddMinutes(-5),
                closeAt = DateTimeOffset.UtcNow.AddHours(4),
                durationMinutes = 90,
                participantMode,
                participantUserIds,
            });
        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var body = await create.Content.ReadFromJsonAsync<JsonElement>();
        var sessionId = body.GetProperty("session").GetProperty("id").GetInt64();

        var publish = await _client.PostAsync($"/api/v1/exam-sessions/{sessionId}/publish", null);
        publish.StatusCode.ShouldBe(HttpStatusCode.OK, await publish.Content.ReadAsStringAsync());

        return sessionId;
    }

    private async Task<long> CreatePaperAsync()
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

    private async Task LoginTeacherAsync() => await LoginAsync(TeacherUsername, TeacherPassword);

    private async Task LoginStudentAsync() => await LoginAsync(StudentUsername, StudentPassword);

    private async Task LoginAsync(string username, string password)
    {
        var response = await _client.PostAsJsonAsync(
            "/api/v1/auth/login",
            new { username, password });

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

    private static async Task<long> SeedUserAsync(AppDbContext db, string username, string password, long roleId)
    {
        var verifier = new Pbkdf2PasswordVerifier();
        var now = DateTimeOffset.UtcNow;

        var user = User.Register(username, username, verifier.Hash(password), now);
        await db.Users.AddAsync(user);
        await db.SaveChangesAsync();

        await db.UserRoles.AddAsync(UserRole.Create(user.Id, roleId, null, now));
        await db.SaveChangesAsync();

        return user.Id;
    }
}

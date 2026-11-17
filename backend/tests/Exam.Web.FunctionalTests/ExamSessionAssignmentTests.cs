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
/// 场次负责人指派。
/// <para>
/// 指派是「阅卷教师限所负责场次」的事实依据：被指派的人看得到这场考试的作答、
/// 成绩与监考数据；没被指派的人看不到。指派不授予权限。
/// </para>
/// </summary>
public sealed class ExamSessionAssignmentTests : IAsyncLifetime
{
    private const string TeacherUsername = "assignteacher1";
    private const string TeacherPassword = "Passw0rd!";
    private const string GraderUsername = "assigngrader1";
    private const string GraderPassword = "Passw0rd!";
    private const string OtherGraderUsername = "assigngrader2";
    private const string OtherGraderPassword = "Passw0rd!";
    private const string StudentUsername = "assignstudent1";
    private const string StudentPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _questionId;
    private long _graderId;
    private long _otherGraderId;

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
            "assign_teacher",
            PermissionCatalog.ExamRead,
            PermissionCatalog.ExamWrite,
            PermissionCatalog.ExamPublish,
            PermissionCatalog.PaperRead,
            PermissionCatalog.PaperWrite,
            PermissionCatalog.PaperPublish,
            PermissionCatalog.QuestionRead,
            PermissionCatalog.QuestionPublish,
            PermissionCatalog.TagRead);

        var graderRoleId = await SeedRoleAsync(
            db,
            "assign_grader",
            PermissionCatalog.ExamRead,
            PermissionCatalog.AttemptTake,
            PermissionCatalog.AttemptReadOwn,
            PermissionCatalog.AttemptReadAll,
            PermissionCatalog.ProctorMonitor,
            PermissionCatalog.AnalyticsRead);

        var studentRoleId = await SeedRoleAsync(
            db,
            "assign_student",
            PermissionCatalog.ExamRead,
            PermissionCatalog.AttemptTake,
            PermissionCatalog.AttemptReadOwn);

        await SeedUserAsync(db, TeacherUsername, TeacherPassword, teacherRoleId);
        _graderId = await SeedUserAsync(db, GraderUsername, GraderPassword, graderRoleId);
        _otherGraderId = await SeedUserAsync(db, OtherGraderUsername, OtherGraderPassword, graderRoleId);
        await SeedUserAsync(db, StudentUsername, StudentPassword, studentRoleId);

        _questionId = await SeedSingleQuestionAsync(db, "Q-ASG-001");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 指派后阅卷教师看得到该场次的作答与成绩_没指派看不到()
    {
        var sessionId = await CreateSessionAsync();
        var attemptId = await StartAttemptAsync(sessionId);

        // 没指派：看不到场次，也看不到别人的作答。
        await LoginAsync(GraderUsername, GraderPassword);

        var sessionBefore = await _client.GetAsync($"/api/v1/exam-sessions/{sessionId}");
        sessionBefore.StatusCode.ShouldBe(HttpStatusCode.Forbidden, await sessionBefore.Content.ReadAsStringAsync());

        var reportBefore = await _client.GetAsync($"/api/v1/attempts/{attemptId}/report");
        reportBefore.StatusCode.ShouldBe(HttpStatusCode.Forbidden, await reportBefore.Content.ReadAsStringAsync());

        // 指派之后：这场的作答、成绩、监考快照都看得见。
        await LoginAsync(TeacherUsername, TeacherPassword);
        var assign = await _client.PutAsJsonAsync(
            $"/api/v1/exam-sessions/{sessionId}/assignments",
            new { userIds = new[] { _graderId } });
        assign.StatusCode.ShouldBe(HttpStatusCode.OK, await assign.Content.ReadAsStringAsync());

        var assignBody = await assign.Content.ReadFromJsonAsync<JsonElement>();
        assignBody.GetProperty("total").GetInt32().ShouldBe(1);
        assignBody.GetProperty("items")[0].GetProperty("userId").GetInt64().ShouldBe(_graderId);

        await LoginAsync(GraderUsername, GraderPassword);

        var sessionAfter = await _client.GetAsync($"/api/v1/exam-sessions/{sessionId}");
        sessionAfter.StatusCode.ShouldBe(HttpStatusCode.OK, await sessionAfter.Content.ReadAsStringAsync());

        var reportAfter = await _client.GetAsync($"/api/v1/attempts/{attemptId}/report");
        reportAfter.StatusCode.ShouldBe(HttpStatusCode.OK, await reportAfter.Content.ReadAsStringAsync());

        var grades = await _client.GetAsync($"/api/v1/exam-sessions/{sessionId}/grades");
        grades.StatusCode.ShouldBe(HttpStatusCode.OK, await grades.Content.ReadAsStringAsync());

        var monitoring = await _client.GetAsync($"/api/v1/exam-sessions/{sessionId}/monitoring");
        monitoring.StatusCode.ShouldBe(HttpStatusCode.OK, await monitoring.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task 指派只给一个人_另一个人仍然看不到()
    {
        var sessionId = await CreateSessionAsync();

        await LoginAsync(TeacherUsername, TeacherPassword);
        var assign = await _client.PutAsJsonAsync(
            $"/api/v1/exam-sessions/{sessionId}/assignments",
            new { userIds = new[] { _graderId } });
        assign.StatusCode.ShouldBe(HttpStatusCode.OK, await assign.Content.ReadAsStringAsync());

        await LoginAsync(OtherGraderUsername, OtherGraderPassword);
        var session = await _client.GetAsync($"/api/v1/exam-sessions/{sessionId}");
        session.StatusCode.ShouldBe(HttpStatusCode.Forbidden, await session.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task 覆盖式指派_重新指派后旧的人失去范围()
    {
        var sessionId = await CreateSessionAsync();

        await LoginAsync(TeacherUsername, TeacherPassword);
        await _client.PutAsJsonAsync(
            $"/api/v1/exam-sessions/{sessionId}/assignments",
            new { userIds = new[] { _graderId } });

        // 改指给别人。
        var reassign = await _client.PutAsJsonAsync(
            $"/api/v1/exam-sessions/{sessionId}/assignments",
            new { userIds = new[] { _otherGraderId } });
        reassign.StatusCode.ShouldBe(HttpStatusCode.OK, await reassign.Content.ReadAsStringAsync());

        var body = await reassign.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("total").GetInt32().ShouldBe(1);
        body.GetProperty("items")[0].GetProperty("userId").GetInt64().ShouldBe(_otherGraderId);

        await LoginAsync(GraderUsername, GraderPassword);
        var session = await _client.GetAsync($"/api/v1/exam-sessions/{sessionId}");
        session.StatusCode.ShouldBe(HttpStatusCode.Forbidden, await session.Content.ReadAsStringAsync());

        await LoginAsync(OtherGraderUsername, OtherGraderPassword);
        var allowed = await _client.GetAsync($"/api/v1/exam-sessions/{sessionId}");
        allowed.StatusCode.ShouldBe(HttpStatusCode.OK, await allowed.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task 重复指派同一个人_幂等()
    {
        var sessionId = await CreateSessionAsync();

        await LoginAsync(TeacherUsername, TeacherPassword);

        var first = await _client.PutAsJsonAsync(
            $"/api/v1/exam-sessions/{sessionId}/assignments",
            new { userIds = new[] { _graderId } });
        first.StatusCode.ShouldBe(HttpStatusCode.OK, await first.Content.ReadAsStringAsync());

        // 再指派一次同一个人：还是一条，不报唯一索引冲突。
        var again = await _client.PutAsJsonAsync(
            $"/api/v1/exam-sessions/{sessionId}/assignments",
            new { userIds = new[] { _graderId } });
        again.StatusCode.ShouldBe(HttpStatusCode.OK, await again.Content.ReadAsStringAsync());

        var body = await again.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("total").GetInt32().ShouldBe(1);
    }

    [Fact]
    public async Task 指派给不存在的账号_返回422()
    {
        var sessionId = await CreateSessionAsync();

        await LoginAsync(TeacherUsername, TeacherPassword);
        var assign = await _client.PutAsJsonAsync(
            $"/api/v1/exam-sessions/{sessionId}/assignments",
            new { userIds = new[] { 999999999L } });

        assign.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task 考生看得到场次但看不到负责人名单()
    {
        var sessionId = await CreateSessionAsync();

        await LoginAsync(TeacherUsername, TeacherPassword);
        await _client.PutAsJsonAsync(
            $"/api/v1/exam-sessions/{sessionId}/assignments",
            new { userIds = new[] { _graderId } });

        await LoginAsync(StudentUsername, StudentPassword);

        var session = await _client.GetAsync($"/api/v1/exam-sessions/{sessionId}");
        session.StatusCode.ShouldBe(HttpStatusCode.OK, await session.Content.ReadAsStringAsync());

        var assignments = await _client.GetAsync($"/api/v1/exam-sessions/{sessionId}/assignments");
        assignments.StatusCode.ShouldBe(HttpStatusCode.Forbidden, await assignments.Content.ReadAsStringAsync());
    }

    // ---------- 造数据 ----------

    private async Task<long> CreateSessionAsync()
    {
        await LoginAsync(TeacherUsername, TeacherPassword);

        var create = await _client.PostAsJsonAsync(
            "/api/v1/papers",
            new
            {
                kind = "exam",
                name = "指派测试卷",
                targetTotalScore = 10,
                durationMinutes = 15,
                answerPolicy = "after_close",
            });
        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var paperId = (await create.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("paper").GetProperty("id").GetInt64();

        var add = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/items",
            new { questionId = _questionId, score = 10m });
        add.StatusCode.ShouldBe(HttpStatusCode.OK, await add.Content.ReadAsStringAsync());

        var publish = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/publish",
            new { warningOverrideReason = "用于验证场次指派" });
        publish.StatusCode.ShouldBe(HttpStatusCode.OK, await publish.Content.ReadAsStringAsync());

        var session = await _client.PostAsJsonAsync(
            "/api/v1/exam-sessions",
            new
            {
                paperId,
                name = "指派测试场次",
                openAt = DateTimeOffset.UtcNow.AddMinutes(-5),
                closeAt = DateTimeOffset.UtcNow.AddHours(4),
                durationMinutes = 90,
                participantMode = "open",
            });
        session.StatusCode.ShouldBe(HttpStatusCode.OK, await session.Content.ReadAsStringAsync());

        var sessionId = (await session.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("session").GetProperty("id").GetInt64();

        var publishSession = await _client.PostAsync($"/api/v1/exam-sessions/{sessionId}/publish", null);
        publishSession.StatusCode.ShouldBe(HttpStatusCode.OK, await publishSession.Content.ReadAsStringAsync());

        return sessionId;
    }

    private async Task<long> StartAttemptAsync(long sessionId)
    {
        await LoginAsync(StudentUsername, StudentPassword);

        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { examSessionId = sessionId });
        start.StatusCode.ShouldBe(HttpStatusCode.OK, await start.Content.ReadAsStringAsync());

        var attemptId = (await start.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("attemptId").GetInt64();

        var save = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/answers",
            new { clientSeq = 1, items = new[] { new { questionId = _questionId, payload = new { selectedOptionKeys = new[] { "A" } } } } });
        save.StatusCode.ShouldBe(HttpStatusCode.OK, await save.Content.ReadAsStringAsync());

        var submit = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/submit", new { reason = "manual" });
        submit.StatusCode.ShouldBe(HttpStatusCode.OK, await submit.Content.ReadAsStringAsync());

        return attemptId;
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

    private static async Task<long> SeedUserAsync(
        AppDbContext db,
        string username,
        string password,
        long roleId)
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

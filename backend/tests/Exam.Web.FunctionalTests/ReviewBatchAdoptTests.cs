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
/// 批量采纳初判：只动待领取的任务，逐条给出结果，操作留痕。
/// </summary>
public sealed class ReviewBatchAdoptTests : IAsyncLifetime
{
    private const string TeacherA = "batchteacher1";
    private const string TeacherB = "batchteacher2";
    private const string TeacherPassword = "Passw0rd!";
    private const string StudentUsername = "batchstudent1";
    private const string StudentPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _shortQuestionId;
    private long _comprehensiveQuestionId;
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
            "batch_teacher",
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
            PermissionCatalog.ReviewBatchAdopt,
            PermissionCatalog.GradePublish);

        await SeedUserAsync(db, TeacherA, TeacherPassword, teacherRoleId);
        await SeedUserAsync(db, TeacherB, TeacherPassword, teacherRoleId);

        var studentRoleId = await SeedRoleAsync(db, "batch_student", PermissionCatalog.AttemptTake, PermissionCatalog.AttemptReadOwn);
        await SeedUserAsync(db, StudentUsername, StudentPassword, studentRoleId);

        _shortQuestionId = await SeedShortQuestionAsync(db, "Q-BAT-001");
        _comprehensiveQuestionId = await SeedComprehensiveQuestionAsync(db, "Q-BAT-002");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 批量采纳后任务已阅完且分数是建议分()
    {
        var attemptId = await StartAttemptAsync(_shortQuestionId);
        await SaveShortAnswerAsync(attemptId);
        await SubmitAsync(attemptId);

        var taskId = await LatestTaskIdAsync();

        await LoginAsync(TeacherA, TeacherPassword);
        var adopt = await _client.PostAsJsonAsync(
            "/api/v1/review-tasks/batch-adopt",
            new { taskIds = new[] { taskId }, maxCount = 200, confirm = true });

        adopt.StatusCode.ShouldBe(HttpStatusCode.OK, await adopt.Content.ReadAsStringAsync());

        var body = await adopt.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("total").GetInt32().ShouldBe(1);
        body.GetProperty("adopted").GetInt32().ShouldBe(1);
        body.GetProperty("skipped").GetInt32().ShouldBe(0);

        var item = body.GetProperty("items")[0];
        item.GetProperty("taskId").GetInt64().ShouldBe(taskId);
        item.GetProperty("status").GetString().ShouldBe("adopted");
        item.GetProperty("finalScore").GetDecimal().ShouldBe(5m);

        // 任务状态：已阅完，最终分就是系统建议分。
        var list = await _client.GetAsync("/api/v1/review-tasks");
        var listBody = await list.Content.ReadFromJsonAsync<JsonElement>();
        var task = listBody.GetProperty("items")[0];
        task.GetProperty("status").GetString().ShouldBe("reviewed");
        task.GetProperty("finalScore").GetDecimal().ShouldBe(5m);

        // 学生端：成绩定分，且看得见这一笔——成绩发布之后。
        await PublishGradesAsync();

        await LoginAsync(StudentUsername, StudentPassword);
        var scores = await _client.GetAsync($"/api/v1/attempts/{attemptId}/scores");
        var summary = await scores.Content.ReadFromJsonAsync<JsonElement>();
        summary.GetProperty("subjectivePending").GetBoolean().ShouldBeFalse();
        summary.GetProperty("totalScore").GetDecimal().ShouldBe(5m);

        var revisions = await _client.GetAsync($"/api/v1/attempts/{attemptId}/grade-revisions");
        var revisionBody = await revisions.Content.ReadFromJsonAsync<JsonElement>();
        revisionBody.GetProperty("total").GetInt32().ShouldBe(1);
        revisionBody.GetProperty("items")[0].GetProperty("newScore").GetDecimal().ShouldBe(5m);
        revisionBody.GetProperty("items")[0].GetProperty("comment").GetString().ShouldBe("系统初判，已批量采纳");
    }

    [Fact]
    public async Task 只影响待领取的任务()
    {
        var attemptId = await StartAttemptAsync(_shortQuestionId);
        await SaveShortAnswerAsync(attemptId);
        await SubmitAsync(attemptId);

        var taskId = await LatestTaskIdAsync();

        // 另一个阅卷人先把任务领走。
        await LoginAsync(TeacherB, TeacherPassword);
        var claim = await _client.PostAsync($"/api/v1/review-tasks/{taskId}/claim", null);
        claim.StatusCode.ShouldBe(HttpStatusCode.OK, await claim.Content.ReadAsStringAsync());

        await LoginAsync(TeacherA, TeacherPassword);
        var adopt = await _client.PostAsJsonAsync(
            "/api/v1/review-tasks/batch-adopt",
            new { taskIds = new[] { taskId }, maxCount = 200, confirm = true });

        adopt.StatusCode.ShouldBe(HttpStatusCode.OK, await adopt.Content.ReadAsStringAsync());

        var body = await adopt.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("total").GetInt32().ShouldBe(1);
        body.GetProperty("adopted").GetInt32().ShouldBe(0);
        body.GetProperty("skipped").GetInt32().ShouldBe(1);

        var item = body.GetProperty("items")[0];
        item.GetProperty("status").GetString().ShouldBe("skipped");
        item.GetProperty("message").GetString()!.ShouldContain("待领取");
        item.GetProperty("finalScore").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task 没有二次确认不执行()
    {
        var attemptId = await StartAttemptAsync(_shortQuestionId);
        await SaveShortAnswerAsync(attemptId);
        await SubmitAsync(attemptId);

        var taskId = await LatestTaskIdAsync();

        await LoginAsync(TeacherA, TeacherPassword);
        var adopt = await _client.PostAsJsonAsync(
            "/api/v1/review-tasks/batch-adopt",
            new { taskIds = new[] { taskId }, maxCount = 200, confirm = false });

        adopt.StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        // 任务还在待领取队列里。
        var list = await _client.GetAsync("/api/v1/review-tasks");
        var body = await list.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("items")[0].GetProperty("status").GetString().ShouldBe("pending");
    }

    [Fact]
    public async Task 没指定范围不执行()
    {
        await LoginAsync(TeacherA, TeacherPassword);
        var adopt = await _client.PostAsJsonAsync(
            "/api/v1/review-tasks/batch-adopt",
            new { maxCount = 200, confirm = true });

        adopt.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task 没有批量采纳权限被拒绝()
    {
        var attemptId = await StartAttemptAsync(_shortQuestionId);
        await SaveShortAnswerAsync(attemptId);
        await SubmitAsync(attemptId);

        var taskId = await LatestTaskIdAsync();

        await LoginAsync(StudentUsername, StudentPassword);
        var adopt = await _client.PostAsJsonAsync(
            "/api/v1/review-tasks/batch-adopt",
            new { taskIds = new[] { taskId }, maxCount = 200, confirm = true });

        adopt.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task 按场次批量采纳所有待阅任务()
    {
        var sessionId = await CreateSessionAsync(_shortQuestionId);

        for (var i = 0; i < 2; i++)
        {
            var attemptId = await StartAttemptAsync(_shortQuestionId, sessionId);
            await SaveShortAnswerAsync(attemptId);
            await SubmitAsync(attemptId);
        }

        await LoginAsync(TeacherA, TeacherPassword);
        var adopt = await _client.PostAsJsonAsync(
            "/api/v1/review-tasks/batch-adopt",
            new { examSessionId = sessionId, maxCount = 200, confirm = true });

        adopt.StatusCode.ShouldBe(HttpStatusCode.OK, await adopt.Content.ReadAsStringAsync());

        var body = await adopt.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("total").GetInt32().ShouldBe(2);
        body.GetProperty("adopted").GetInt32().ShouldBe(2);
        body.GetProperty("skipped").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task 综合题分步采纳全部采纳完才定分()
    {
        var attemptId = await StartAttemptAsync(_comprehensiveQuestionId);

        await SaveAnswerAsync(
            attemptId,
            _comprehensiveQuestionId,
            new
            {
                steps = new[]
                {
                    new { code = "S1", text = "先建立连接" },
                    new { code = "S2", text = "再释放连接" },
                },
            });

        await SubmitAsync(attemptId);

        var taskIds = await TaskIdsByStepAsync();

        await LoginAsync(TeacherA, TeacherPassword);

        // 只采纳第一步：整题还没定分。
        var first = await _client.PostAsJsonAsync(
            "/api/v1/review-tasks/batch-adopt",
            new { taskIds = new[] { taskIds["S1"] }, maxCount = 200, confirm = true });
        first.StatusCode.ShouldBe(HttpStatusCode.OK, await first.Content.ReadAsStringAsync());

        var firstBody = await first.Content.ReadFromJsonAsync<JsonElement>();
        firstBody.GetProperty("adopted").GetInt32().ShouldBe(1);

        await LoginAsync(StudentUsername, StudentPassword);
        var scores = await _client.GetAsync($"/api/v1/attempts/{attemptId}/scores");
        var summary = await scores.Content.ReadFromJsonAsync<JsonElement>();
        summary.GetProperty("subjectivePending").GetBoolean().ShouldBeTrue();

        // 两步都采纳：整题定分。
        await LoginAsync(TeacherA, TeacherPassword);
        var second = await _client.PostAsJsonAsync(
            "/api/v1/review-tasks/batch-adopt",
            new { taskIds = new[] { taskIds["S2"] }, maxCount = 200, confirm = true });
        second.StatusCode.ShouldBe(HttpStatusCode.OK, await second.Content.ReadAsStringAsync());

        var secondBody = await second.Content.ReadFromJsonAsync<JsonElement>();
        secondBody.GetProperty("adopted").GetInt32().ShouldBe(1);

        await LoginAsync(StudentUsername, StudentPassword);
        var finalScores = await _client.GetAsync($"/api/v1/attempts/{attemptId}/scores");
        var finalSummary = await finalScores.Content.ReadFromJsonAsync<JsonElement>();
        finalSummary.GetProperty("subjectivePending").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task 批量采纳留下审计记录()
    {
        var attemptId = await StartAttemptAsync(_shortQuestionId);
        await SaveShortAnswerAsync(attemptId);
        await SubmitAsync(attemptId);

        var taskId = await LatestTaskIdAsync();

        await LoginAsync(TeacherA, TeacherPassword);
        var adopt = await _client.PostAsJsonAsync(
            "/api/v1/review-tasks/batch-adopt",
            new { taskIds = new[] { taskId }, maxCount = 200, confirm = true });
        adopt.StatusCode.ShouldBe(HttpStatusCode.OK);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var count = await db.Database
            .SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM audit.audit_log WHERE action = 'review_task.batch_adopt'")
            .FirstAsync();

        count.ShouldBeGreaterThanOrEqualTo(1);
    }

    private async Task SaveShortAnswerAsync(long attemptId) =>
        await SaveAnswerAsync(
            attemptId,
            _shortQuestionId,
            new { text = "TCP 三次握手可以建立连接" });

    private async Task SaveAnswerAsync(long attemptId, long questionId, object payload)
    {
        var save = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/answers",
            new { clientSeq = 1, items = new[] { new { questionId, payload } } });

        save.StatusCode.ShouldBe(HttpStatusCode.OK, await save.Content.ReadAsStringAsync());
    }

    private async Task SubmitAsync(long attemptId)
    {
        var submit = await _client.PostAsJsonAsync($"/api/v1/attempts/{attemptId}/submit", new { reason = "manual" });
        submit.StatusCode.ShouldBe(HttpStatusCode.OK, await submit.Content.ReadAsStringAsync());
    }

    private async Task<long> LatestTaskIdAsync()
    {
        await LoginAsync(TeacherA, TeacherPassword);

        var list = await _client.GetAsync("/api/v1/review-tasks");
        list.StatusCode.ShouldBe(HttpStatusCode.OK, await list.Content.ReadAsStringAsync());

        var body = await list.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray().ToList();
        return items[^1].GetProperty("id").GetInt64();
    }

    private async Task<Dictionary<string, long>> TaskIdsByStepAsync()
    {
        await LoginAsync(TeacherA, TeacherPassword);

        var list = await _client.GetAsync("/api/v1/review-tasks");
        list.StatusCode.ShouldBe(HttpStatusCode.OK, await list.Content.ReadAsStringAsync());

        var body = await list.Content.ReadFromJsonAsync<JsonElement>();
        var result = new Dictionary<string, long>();

        foreach (var item in body.GetProperty("items").EnumerateArray())
        {
            var step = item.GetProperty("stepCode").GetString();
            if (!string.IsNullOrEmpty(step))
            {
                result[step] = item.GetProperty("id").GetInt64();
            }
        }

        return result;
    }

    private async Task<long> StartAttemptAsync(long questionId, long? sessionId = null)
    {
        await LoginAsync(TeacherA, TeacherPassword);
        sessionId ??= await CreateSessionAsync(questionId);
        _sessionId = sessionId.Value;

        await LoginAsync(StudentUsername, StudentPassword);

        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { examSessionId = sessionId });
        start.StatusCode.ShouldBe(HttpStatusCode.OK, await start.Content.ReadAsStringAsync());

        var body = await start.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("attemptId").GetInt64();
    }

    private async Task<long> CreateSessionAsync(long questionId)
    {
        // 建卷建场次是老师的活儿。
        await LoginAsync(TeacherA, TeacherPassword);

        var create = await _client.PostAsJsonAsync(
            "/api/v1/papers",
            new
            {
                kind = "exam",
                name = "批量采纳测试考试",
                targetTotalScore = 10,
                durationMinutes = 15,
                allowRetake = true,
            });
        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var paperBody = await create.Content.ReadFromJsonAsync<JsonElement>();
        var paperId = paperBody.GetProperty("paper").GetProperty("id").GetInt64();

        var add = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/items",
            new { questionId, score = 10m });
        add.StatusCode.ShouldBe(HttpStatusCode.OK, await add.Content.ReadAsStringAsync());

        var publishPaper = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/publish",
            new { warningOverrideReason = "本次含主观题，用于验证批量采纳初判" });
        publishPaper.StatusCode.ShouldBe(HttpStatusCode.OK, await publishPaper.Content.ReadAsStringAsync());

        var session = await _client.PostAsJsonAsync(
            "/api/v1/exam-sessions",
            new
            {
                paperId,
                name = "批量采纳测试考试",
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

    /// <summary>发布成绩。成绩没发布之前，学生看不到主观题的分。</summary>
    private async Task PublishGradesAsync()
    {
        await LoginAsync(TeacherA, TeacherPassword);

        var publish = await _client.PostAsJsonAsync(
            $"/api/v1/exam-sessions/{_sessionId}/publish-grades",
            new { scope = "all" });

        publish.StatusCode.ShouldBe(HttpStatusCode.OK, await publish.Content.ReadAsStringAsync());
    }

    private async Task LoginAsync(string username, string password)
    {
        var response = await _client.PostAsJsonAsync("/api/v1/auth/login", new { username, password });
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        _client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", body.GetProperty("accessToken").GetString());
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

    private static async Task<long> SeedComprehensiveQuestionAsync(AppDbContext db, string code)
    {
        var now = DateTimeOffset.UtcNow;
        var question = Question.CreateDraft(code, QuestionType.Comprehensive, "题干", Score.Question(10), 1, now);
        question.AddStep(QuestionStep.Create("S1", "第一步", "建立连接", ["建立", "连接"], Score.Question(6), 0), now);
        question.AddStep(QuestionStep.Create("S2", "第二步", "释放连接", ["释放", "连接"], Score.Question(4), 1), now);

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

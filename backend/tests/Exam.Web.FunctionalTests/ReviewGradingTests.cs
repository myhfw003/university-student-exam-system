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
/// 人工评分与改分流水。
/// <para>
/// 分数 0..满分、0.5 为步进；每评一次留一条流水，学生端看得见改分记录。
/// </para>
/// </summary>
public sealed class ReviewGradingTests : IAsyncLifetime
{
    private const string TeacherA = "grader01";
    private const string TeacherB = "grader02";
    private const string TeacherPassword = "Passw0rd!";
    private const string StudentUsername = "gradestudent1";
    private const string OtherStudentUsername = "gradestudent2";
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
            "grading_teacher",
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

        await SeedUserAsync(db, TeacherA, TeacherPassword, teacherRoleId);
        await SeedUserAsync(db, TeacherB, TeacherPassword, teacherRoleId);

        var studentRoleId = await SeedRoleAsync(db, "grading_student", PermissionCatalog.AttemptTake, PermissionCatalog.AttemptReadOwn);
        await SeedUserAsync(db, StudentUsername, StudentPassword, studentRoleId);
        await SeedUserAsync(db, OtherStudentUsername, StudentPassword, studentRoleId);

        _shortQuestionId = await SeedShortQuestionAsync(db, "Q-GRD-001");
        _comprehensiveQuestionId = await SeedComprehensiveQuestionAsync(db, "Q-GRD-002");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 评分后任务已阅完且评分结果定分()
    {
        var attemptId = await StartAttemptAsync(_shortQuestionId);
        await SaveShortAnswerAsync(attemptId);
        await SubmitAsync(attemptId);

        var taskId = await LatestTaskIdAsync();

        await LoginAsync(TeacherA, TeacherPassword);
        var grade = await _client.PostAsJsonAsync(
            $"/api/v1/review-tasks/{taskId}/grade",
            new { score = 7.5m, comment = "要点 1、2 覆盖到位，要点 3 缺失" });

        grade.StatusCode.ShouldBe(HttpStatusCode.OK, await grade.Content.ReadAsStringAsync());

        var body = await grade.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("status").GetString().ShouldBe("reviewed");
        body.GetProperty("statusLabel").GetString().ShouldBe("已阅完");
        body.GetProperty("finalScore").GetDecimal().ShouldBe(7.5m);
        body.GetProperty("maxScore").GetDecimal().ShouldBe(10m);
        body.GetProperty("comment").GetString().ShouldBe("要点 1、2 覆盖到位，要点 3 缺失");
        body.GetProperty("scoreResultStatus").GetString().ShouldBe("final");
        body.GetProperty("revision").GetInt32().ShouldBe(1);

        // 成绩发布之后，学生端看到的是定分后的完整成绩。
        await PublishGradesAsync();

        await LoginAsync(StudentUsername, StudentPassword);
        var scores = await _client.GetAsync($"/api/v1/attempts/{attemptId}/scores");
        scores.StatusCode.ShouldBe(HttpStatusCode.OK);

        var summary = await scores.Content.ReadFromJsonAsync<JsonElement>();
        summary.GetProperty("subjectivePending").GetBoolean().ShouldBeFalse();
        summary.GetProperty("totalScore").GetDecimal().ShouldBe(7.5m);
    }

    [Fact]
    public async Task 分数超过满分被拒绝()
    {
        var taskId = await PrepareShortTaskAsync();

        await LoginAsync(TeacherA, TeacherPassword);
        var grade = await _client.PostAsJsonAsync(
            $"/api/v1/review-tasks/{taskId}/grade",
            new { score = 10.5m, comment = (string?)null });

        grade.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);

        var problem = await grade.Content.ReadFromJsonAsync<JsonElement>();
        problem.GetProperty("detail").GetString()!.ShouldContain("满分");
    }

    [Fact]
    public async Task 分数不是零点五步进被拒绝()
    {
        var taskId = await PrepareShortTaskAsync();

        await LoginAsync(TeacherA, TeacherPassword);
        var grade = await _client.PostAsJsonAsync(
            $"/api/v1/review-tasks/{taskId}/grade",
            new { score = 7.3m, comment = (string?)null });

        grade.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);

        var problem = await grade.Content.ReadFromJsonAsync<JsonElement>();
        problem.GetProperty("detail").GetString()!.ShouldContain("步进");
    }

    [Fact]
    public async Task 负分被拒绝()
    {
        var taskId = await PrepareShortTaskAsync();

        await LoginAsync(TeacherA, TeacherPassword);
        var grade = await _client.PostAsJsonAsync(
            $"/api/v1/review-tasks/{taskId}/grade",
            new { score = -1m, comment = (string?)null });

        grade.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task 改分留痕学生端看得见()
    {
        var attemptId = await StartAttemptAsync(_shortQuestionId);
        await SaveShortAnswerAsync(attemptId);
        await SubmitAsync(attemptId);

        var taskId = await LatestTaskIdAsync();

        await LoginAsync(TeacherA, TeacherPassword);

        var first = await _client.PostAsJsonAsync(
            $"/api/v1/review-tasks/{taskId}/grade",
            new { score = 7.5m, comment = "初次评分" });
        first.StatusCode.ShouldBe(HttpStatusCode.OK, await first.Content.ReadAsStringAsync());

        // 改分：允许，但每改一次都留一条流水。
        var second = await _client.PostAsJsonAsync(
            $"/api/v1/review-tasks/{taskId}/grade",
            new { score = 9m, comment = "复核后调整" });
        second.StatusCode.ShouldBe(HttpStatusCode.OK, await second.Content.ReadAsStringAsync());

        var body = await second.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("finalScore").GetDecimal().ShouldBe(9m);
        body.GetProperty("revision").GetInt32().ShouldBe(2);

        // 学生端能看到改分记录——成绩发布之后。
        await PublishGradesAsync();

        await LoginAsync(StudentUsername, StudentPassword);
        var revisions = await _client.GetAsync($"/api/v1/attempts/{attemptId}/grade-revisions");
        revisions.StatusCode.ShouldBe(HttpStatusCode.OK, await revisions.Content.ReadAsStringAsync());

        var list = await revisions.Content.ReadFromJsonAsync<JsonElement>();
        list.GetProperty("total").GetInt32().ShouldBe(2);

        var items = list.GetProperty("items").EnumerateArray().ToList();
        items[0].GetProperty("previousScore").GetDecimal().ShouldBe(5m);
        items[0].GetProperty("newScore").GetDecimal().ShouldBe(7.5m);
        items[0].GetProperty("comment").GetString().ShouldBe("初次评分");
        items[1].GetProperty("previousScore").GetDecimal().ShouldBe(7.5m);
        items[1].GetProperty("newScore").GetDecimal().ShouldBe(9m);
        items[1].GetProperty("comment").GetString().ShouldBe("复核后调整");
        items[1].GetProperty("questionId").GetInt64().ShouldBe(_shortQuestionId);
    }

    [Fact]
    public async Task 别人的改分记录看不到()
    {
        var attemptId = await StartAttemptAsync(_shortQuestionId);
        await SaveShortAnswerAsync(attemptId);
        await SubmitAsync(attemptId);

        var taskId = await LatestTaskIdAsync();

        await LoginAsync(TeacherA, TeacherPassword);
        await _client.PostAsJsonAsync(
            $"/api/v1/review-tasks/{taskId}/grade",
            new { score = 7.5m, comment = "评分" });

        await LoginAsync(OtherStudentUsername, StudentPassword);
        var revisions = await _client.GetAsync($"/api/v1/attempts/{attemptId}/grade-revisions");

        revisions.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task 综合题分步评分全部评完才定分()
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

        // 第一步评完：只更新总分，还不定分。
        var first = await _client.PostAsJsonAsync(
            $"/api/v1/review-tasks/{taskIds["S1"]}/grade",
            new { score = 5m, comment = "第一步基本到位" });
        first.StatusCode.ShouldBe(HttpStatusCode.OK, await first.Content.ReadAsStringAsync());

        var firstBody = await first.Content.ReadFromJsonAsync<JsonElement>();
        firstBody.GetProperty("maxScore").GetDecimal().ShouldBe(6m);
        firstBody.GetProperty("scoreResultStatus").GetString().ShouldBe("suggested");
        firstBody.GetProperty("revision").GetInt32().ShouldBe(1);

        // 第二步评完：整题定分。
        var second = await _client.PostAsJsonAsync(
            $"/api/v1/review-tasks/{taskIds["S2"]}/grade",
            new { score = 3.5m, comment = "第二步基本到位" });
        second.StatusCode.ShouldBe(HttpStatusCode.OK, await second.Content.ReadAsStringAsync());

        var secondBody = await second.Content.ReadFromJsonAsync<JsonElement>();
        secondBody.GetProperty("maxScore").GetDecimal().ShouldBe(4m);
        secondBody.GetProperty("scoreResultStatus").GetString().ShouldBe("final");
        secondBody.GetProperty("revision").GetInt32().ShouldBe(2);

        // 学生端：两道改分流水都指向这道题。
        await PublishGradesAsync();

        await LoginAsync(StudentUsername, StudentPassword);
        var revisions = await _client.GetAsync($"/api/v1/attempts/{attemptId}/grade-revisions");
        revisions.StatusCode.ShouldBe(HttpStatusCode.OK);

        var list = await revisions.Content.ReadFromJsonAsync<JsonElement>();
        list.GetProperty("total").GetInt32().ShouldBe(2);

        var items = list.GetProperty("items").EnumerateArray().ToList();
        items.ShouldAllBe(item => item.GetProperty("questionId").GetInt64() == _comprehensiveQuestionId);
    }

    [Fact]
    public async Task 别人正在阅的卷子不能评分()
    {
        var taskId = await PrepareShortTaskAsync();

        await LoginAsync(TeacherA, TeacherPassword);
        var claim = await _client.PostAsync($"/api/v1/review-tasks/{taskId}/claim", null);
        claim.StatusCode.ShouldBe(HttpStatusCode.OK, await claim.Content.ReadAsStringAsync());

        await LoginAsync(TeacherB, TeacherPassword);
        var grade = await _client.PostAsJsonAsync(
            $"/api/v1/review-tasks/{taskId}/grade",
            new { score = 7.5m, comment = (string?)null });

        grade.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);

        var problem = await grade.Content.ReadFromJsonAsync<JsonElement>();
        problem.GetProperty("detail").GetString()!.ShouldContain("其他阅卷人");
    }

    [Fact]
    public async Task 没有阅卷权限不能评分()
    {
        var taskId = await PrepareShortTaskAsync();

        await LoginAsync(StudentUsername, StudentPassword);
        var grade = await _client.PostAsJsonAsync(
            $"/api/v1/review-tasks/{taskId}/grade",
            new { score = 7.5m, comment = (string?)null });

        grade.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task 评分留下审计记录()
    {
        var taskId = await PrepareShortTaskAsync();

        await LoginAsync(TeacherA, TeacherPassword);
        var grade = await _client.PostAsJsonAsync(
            $"/api/v1/review-tasks/{taskId}/grade",
            new { score = 7.5m, comment = "评分" });
        grade.StatusCode.ShouldBe(HttpStatusCode.OK);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var count = await db.Database
            .SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM audit.audit_log WHERE action = 'review_task.grade'")
            .FirstAsync();

        count.ShouldBeGreaterThanOrEqualTo(1);
    }

    /// <summary>造一份待阅的简答题任务。</summary>
    private async Task<long> PrepareShortTaskAsync()
    {
        var attemptId = await StartAttemptAsync(_shortQuestionId);
        await SaveShortAnswerAsync(attemptId);
        await SubmitAsync(attemptId);
        return await LatestTaskIdAsync();
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

    private async Task<long> StartAttemptAsync(params long[] questionIds)
    {
        await LoginAsync(TeacherA, TeacherPassword);
        var sessionId = await CreateSessionAsync(questionIds);
        _sessionId = sessionId;

        await LoginAsync(StudentUsername, StudentPassword);

        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { examSessionId = sessionId });
        start.StatusCode.ShouldBe(HttpStatusCode.OK, await start.Content.ReadAsStringAsync());

        var body = await start.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("attemptId").GetInt64();
    }

    private async Task<long> CreateSessionAsync(long[] questionIds)
    {
        var create = await _client.PostAsJsonAsync(
            "/api/v1/papers",
            new
            {
                kind = "exam",
                name = "评分测试考试",
                targetTotalScore = 10 * questionIds.Length,
                durationMinutes = 15,
            });
        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var paperBody = await create.Content.ReadFromJsonAsync<JsonElement>();
        var paperId = paperBody.GetProperty("paper").GetProperty("id").GetInt64();

        foreach (var questionId in questionIds)
        {
            var add = await _client.PostAsJsonAsync(
                $"/api/v1/papers/{paperId}/items",
                new { questionId, score = 10m });
            add.StatusCode.ShouldBe(HttpStatusCode.OK, await add.Content.ReadAsStringAsync());
        }

        var publishPaper = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/publish",
            new { warningOverrideReason = "本次含主观题，用于验证人工评分" });
        publishPaper.StatusCode.ShouldBe(HttpStatusCode.OK, await publishPaper.Content.ReadAsStringAsync());

        var session = await _client.PostAsJsonAsync(
            "/api/v1/exam-sessions",
            new
            {
                paperId,
                name = "评分测试考试",
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

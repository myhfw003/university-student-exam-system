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

/// <summary>阅卷任务生成的端到端测试。</summary>
public sealed class ReviewTaskTests : IAsyncLifetime
{
    private const string TeacherUsername = "reviewteacher1";
    private const string TeacherPassword = "Passw0rd!";
    private const string StudentUsername = "reviewstudent1";
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
    private long _comprehensiveQuestionId;

    public async Task InitializeAsync()
    {
        await _postgres.StartAsync();

        _factory = new ExamWebFactory(_postgres.GetConnectionString());
        _client = _factory.CreateClient();
        _client.BaseAddress = new Uri("http://localhost");

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.MigrateAsync();

        var teacherRoleId = await SeedRoleAsync(db, "review_teacher", PermissionCatalog.ExamRead, PermissionCatalog.ExamWrite, PermissionCatalog.ExamPublish, PermissionCatalog.PaperRead, PermissionCatalog.PaperWrite, PermissionCatalog.PaperPublish, PermissionCatalog.QuestionRead, PermissionCatalog.QuestionPublish, PermissionCatalog.TagRead, PermissionCatalog.ReviewGrade);
        await SeedUserAsync(db, TeacherUsername, TeacherPassword, teacherRoleId);

        var studentRoleId = await SeedRoleAsync(db, "review_student", PermissionCatalog.AttemptTake, PermissionCatalog.AttemptReadOwn);
        await SeedUserAsync(db, StudentUsername, StudentPassword, studentRoleId);

        _singleQuestionId = await SeedSingleQuestionAsync(db, "Q-REV-001");
        _shortQuestionId = await SeedShortQuestionAsync(db, "Q-REV-002");
        _comprehensiveQuestionId = await SeedComprehensiveQuestionAsync(db, "Q-REV-003");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 简答题交卷后生成待阅任务()
    {
        var attemptId = await StartAttemptAsync();

        await SaveAnswerAsync(attemptId, _shortQuestionId, new { text = "TCP 三次握手可以建立连接" });
        await SubmitAsync(attemptId);

        await LoginAsync(TeacherUsername, TeacherPassword);
        var list = await _client.GetAsync("/api/v1/review-tasks");
        list.StatusCode.ShouldBe(HttpStatusCode.OK, await list.Content.ReadAsStringAsync());

        var body = await list.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("total").GetInt32().ShouldBe(1);

        var task = body.GetProperty("items")[0];
        task.GetProperty("status").GetString().ShouldBe("pending");
        task.GetProperty("attemptNo").GetInt32().ShouldBe(1);
        task.GetProperty("examName").GetString().ShouldBe("计算机网络期中考试");
        task.GetProperty("questionCode").GetString().ShouldBe("Q-REV-002");
        task.GetProperty("answerText").GetString()!.ShouldContain("三次握手");
        task.GetProperty("suggestedScore").GetDecimal().ShouldBe(5m);
        task.GetProperty("maxScore").GetDecimal().ShouldBe(10m);
    }

    [Fact]
    public async Task 综合题按步骤拆成多条任务()
    {
        var attemptId = await StartAttemptAsync();

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

        await LoginAsync(TeacherUsername, TeacherPassword);
        var list = await _client.GetAsync("/api/v1/review-tasks");
        var body = await list.Content.ReadFromJsonAsync<JsonElement>();

        body.GetProperty("total").GetInt32().ShouldBe(2);

        var tasks = body.GetProperty("items").EnumerateArray().ToList();
        tasks.Select(t => t.GetProperty("stepCode").GetString()).ShouldBe(["S1", "S2"]);

        // 步骤满分按卷面步骤分拆分：6 + 4。
        tasks[0].GetProperty("maxScore").GetDecimal().ShouldBe(6m);
        tasks[1].GetProperty("maxScore").GetDecimal().ShouldBe(4m);
    }

    [Fact]
    public async Task 客观题不生成阅卷任务()
    {
        var attemptId = await StartAttemptAsync();

        await SaveAnswerAsync(attemptId, _singleQuestionId, new { selectedOptionKeys = new[] { "A" } });
        await SubmitAsync(attemptId);

        await LoginAsync(TeacherUsername, TeacherPassword);
        var list = await _client.GetAsync("/api/v1/review-tasks");
        var body = await list.Content.ReadFromJsonAsync<JsonElement>();

        body.GetProperty("total").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task 待阅计数可查()
    {
        var attemptId = await StartAttemptAsync();
        await SaveAnswerAsync(attemptId, _shortQuestionId, new { text = "作答" });
        await SubmitAsync(attemptId);

        await LoginAsync(TeacherUsername, TeacherPassword);
        var count = await _client.GetAsync("/api/v1/review-tasks/count");
        count.StatusCode.ShouldBe(HttpStatusCode.OK);

        var body = await count.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("pending").GetInt32().ShouldBe(1);
        body.GetProperty("inReview").GetInt32().ShouldBe(0);
        body.GetProperty("reviewed").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task 没有阅卷权限看不到队列()
    {
        await LoginAsync(StudentUsername, StudentPassword);
        var list = await _client.GetAsync("/api/v1/review-tasks");

        list.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    private async Task SaveAnswerAsync(long attemptId, long questionId, object payload)
    {
        var save = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/answers",
            new { clientSeq = 1, items = new[] { new { questionId, payload } } });

        save.StatusCode.ShouldBe(HttpStatusCode.OK, await save.Content.ReadAsStringAsync());
    }

    private async Task SubmitAsync(long attemptId)
    {
        var submit = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/submit",
            new { reason = "manual" });

        submit.StatusCode.ShouldBe(HttpStatusCode.OK, await submit.Content.ReadAsStringAsync());
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
                targetTotalScore = 30,
                durationMinutes = 15,
            });
        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var paperBody = await create.Content.ReadFromJsonAsync<JsonElement>();
        var paperId = paperBody.GetProperty("paper").GetProperty("id").GetInt64();

        foreach (var questionId in new[] { _singleQuestionId, _shortQuestionId, _comprehensiveQuestionId })
        {
            var add = await _client.PostAsJsonAsync(
                $"/api/v1/papers/{paperId}/items",
                new { questionId, score = 10m });
            add.StatusCode.ShouldBe(HttpStatusCode.OK, await add.Content.ReadAsStringAsync());
        }

        var publishPaper = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/publish",
            new { warningOverrideReason = "本次含主观题，用于验证阅卷任务生成" });
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

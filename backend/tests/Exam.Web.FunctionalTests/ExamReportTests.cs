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
/// 成绩报告与答案公布。
/// <para>
/// 答案公布三档策略：开考即公布、交卷后公布、场次关闭后公布。
/// 考试进行中，答题接口永远不返回答案。
/// </para>
/// </summary>
public sealed class ExamReportTests : IAsyncLifetime
{
    private const string TeacherUsername = "reportteacher1";
    private const string TeacherPassword = "Passw0rd!";
    private const string StudentUsername = "reportstudent1";
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

        var teacherRoleId = await SeedRoleAsync(
            db,
            "report_teacher",
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
            PermissionCatalog.GradePublish,
            PermissionCatalog.AnalyticsRead);

        await SeedUserAsync(db, TeacherUsername, TeacherPassword, teacherRoleId);

        var studentRoleId = await SeedRoleAsync(db, "report_student", PermissionCatalog.AttemptTake, PermissionCatalog.AttemptReadOwn);
        await SeedUserAsync(db, StudentUsername, StudentPassword, studentRoleId);

        _singleQuestionId = await SeedSingleQuestionAsync(db, "Q-RPT-001");
        _shortQuestionId = await SeedShortQuestionAsync(db, "Q-RPT-002");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 开考即公布交卷后就能看到答案与解析()
    {
        var sessionId = await CreateSessionAsync("immediately");
        var attemptId = await StartAttemptAsync(sessionId);

        await SaveAnswerAsync(attemptId, _singleQuestionId, new { selectedOptionKeys = new[] { "A" } });
        await SaveAnswerAsync(attemptId, _shortQuestionId, new { text = "TCP 三次握手可以建立连接" });
        await SubmitAsync(attemptId);

        await LoginAsync(StudentUsername, StudentPassword);
        var report = await _client.GetAsync($"/api/v1/attempts/{attemptId}/report");
        report.StatusCode.ShouldBe(HttpStatusCode.OK, await report.Content.ReadAsStringAsync());

        var body = await report.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("answersRevealed").GetBoolean().ShouldBeTrue();
        body.GetProperty("answerPolicy").GetString().ShouldBe("immediately");

        var objective = DetailOf(body, _singleQuestionId);
        objective.GetProperty("revealed").GetBoolean().ShouldBeTrue();
        objective.GetProperty("correctKeys").EnumerateArray().Select(k => k.GetString()).ShouldBe(["A"]);
        objective.GetProperty("analysis").GetString()!.ShouldBe("解析：选 A。");

        var subjective = DetailOf(body, _shortQuestionId);
        subjective.GetProperty("revealed").GetBoolean().ShouldBeTrue();
        subjective.GetProperty("referenceAnswer").GetString()!.ShouldBe("参考答案：三次握手。");
        subjective.GetProperty("yourAnswer").GetProperty("text").GetString()!.ShouldContain("三次握手");
    }

    [Fact]
    public async Task 交卷后公布本人交卷才能看到()
    {
        var sessionId = await CreateSessionAsync("after_submit");
        var attemptId = await StartAttemptAsync(sessionId);

        await SaveAnswerAsync(attemptId, _singleQuestionId, new { selectedOptionKeys = new[] { "A" } });

        // 还没交卷：报告里没有答案。
        await LoginAsync(StudentUsername, StudentPassword);
        var before = await _client.GetAsync($"/api/v1/attempts/{attemptId}/report");
        before.StatusCode.ShouldBe(HttpStatusCode.OK, await before.Content.ReadAsStringAsync());

        var beforeBody = await before.Content.ReadFromJsonAsync<JsonElement>();
        beforeBody.GetProperty("answersRevealed").GetBoolean().ShouldBeFalse();

        var beforeObjective = DetailOf(beforeBody, _singleQuestionId);
        beforeObjective.GetProperty("revealed").GetBoolean().ShouldBeFalse();
        beforeObjective.GetProperty("correctKeys").GetArrayLength().ShouldBe(0);
        beforeObjective.GetProperty("analysis").ValueKind.ShouldBe(JsonValueKind.Null);

        // 交卷之后：答案才给。
        await SubmitAsync(attemptId);

        var after = await _client.GetAsync($"/api/v1/attempts/{attemptId}/report");
        var afterBody = await after.Content.ReadFromJsonAsync<JsonElement>();
        afterBody.GetProperty("answersRevealed").GetBoolean().ShouldBeTrue();
        DetailOf(afterBody, _singleQuestionId).GetProperty("correctKeys")
            .EnumerateArray().Select(k => k.GetString()).ShouldBe(["A"]);
    }

    [Fact]
    public async Task 场次关闭后才公布()
    {
        var sessionId = await CreateSessionAsync("after_close");
        var attemptId = await StartAttemptAsync(sessionId);

        await SaveAnswerAsync(attemptId, _singleQuestionId, new { selectedOptionKeys = new[] { "A" } });
        await SubmitAsync(attemptId);

        await LoginAsync(StudentUsername, StudentPassword);
        var before = await _client.GetAsync($"/api/v1/attempts/{attemptId}/report");
        var beforeBody = await before.Content.ReadFromJsonAsync<JsonElement>();
        beforeBody.GetProperty("answersRevealed").GetBoolean().ShouldBeFalse();

        // 场次关闭之后才公布。
        await LoginAsync(TeacherUsername, TeacherPassword);
        var close = await _client.PostAsync($"/api/v1/exam-sessions/{sessionId}/close", null);
        close.StatusCode.ShouldBe(HttpStatusCode.OK, await close.Content.ReadAsStringAsync());

        await LoginAsync(StudentUsername, StudentPassword);
        var after = await _client.GetAsync($"/api/v1/attempts/{attemptId}/report");
        var afterBody = await after.Content.ReadFromJsonAsync<JsonElement>();
        afterBody.GetProperty("answersRevealed").GetBoolean().ShouldBeTrue();
        DetailOf(afterBody, _singleQuestionId).GetProperty("correctKeys")
            .EnumerateArray().Select(k => k.GetString()).ShouldBe(["A"]);
    }

    [Fact]
    public async Task 考试进行中答题接口永不返回答案()
    {
        var sessionId = await CreateSessionAsync("immediately");
        var attemptId = await StartAttemptAsync(sessionId);

        await LoginAsync(StudentUsername, StudentPassword);
        var attempt = await _client.GetAsync($"/api/v1/attempts/{attemptId}");
        attempt.StatusCode.ShouldBe(HttpStatusCode.OK, await attempt.Content.ReadAsStringAsync());

        var raw = await attempt.Content.ReadAsStringAsync();

        // 卷面里没有正确选项、没有解析、没有参考答案。
        raw.ShouldNotContain("correctKeys");
        raw.ShouldNotContain("correctAnswer");
        raw.ShouldNotContain("解析：选 A。");
        raw.ShouldNotContain("参考答案：三次握手。");
    }

    [Fact]
    public async Task 成绩没发布前报告里主观题的分是空的()
    {
        var sessionId = await CreateSessionAsync("immediately");
        var attemptId = await StartAttemptAsync(sessionId);

        await SaveAnswerAsync(attemptId, _singleQuestionId, new { selectedOptionKeys = new[] { "A" } });
        await SaveAnswerAsync(attemptId, _shortQuestionId, new { text = "TCP 三次握手可以建立连接" });
        await SubmitAsync(attemptId);

        await LoginAsync(StudentUsername, StudentPassword);
        var before = await _client.GetAsync($"/api/v1/attempts/{attemptId}/report");
        var beforeBody = await before.Content.ReadFromJsonAsync<JsonElement>();

        // 客观题的分照旧给，主观题的建议分扣住。
        DetailOf(beforeBody, _singleQuestionId).GetProperty("score").GetDecimal().ShouldBe(10m);
        DetailOf(beforeBody, _shortQuestionId).GetProperty("score").ValueKind.ShouldBe(JsonValueKind.Null);
        beforeBody.GetProperty("subjectiveScore").ValueKind.ShouldBe(JsonValueKind.Null);
        beforeBody.GetProperty("totalScore").GetDecimal().ShouldBe(10m);

        // 发布之后，完整成绩出来。
        await LoginAsync(TeacherUsername, TeacherPassword);
        var publish = await _client.PostAsJsonAsync(
            $"/api/v1/exam-sessions/{sessionId}/publish-grades",
            new { scope = "all" });
        publish.StatusCode.ShouldBe(HttpStatusCode.OK, await publish.Content.ReadAsStringAsync());

        await LoginAsync(StudentUsername, StudentPassword);
        var after = await _client.GetAsync($"/api/v1/attempts/{attemptId}/report");
        var afterBody = await after.Content.ReadFromJsonAsync<JsonElement>();
        DetailOf(afterBody, _shortQuestionId).GetProperty("score").GetDecimal().ShouldBe(5m);
        afterBody.GetProperty("subjectiveScore").GetDecimal().ShouldBe(5m);
        afterBody.GetProperty("totalScore").GetDecimal().ShouldBe(15m);
        afterBody.GetProperty("status").GetString().ShouldBe("published");
    }

    [Fact]
    public async Task 我的成绩列表()
    {
        var sessionId = await CreateSessionAsync("immediately");
        var attemptId = await StartAttemptAsync(sessionId);

        await SaveAnswerAsync(attemptId, _singleQuestionId, new { selectedOptionKeys = new[] { "A" } });
        await SubmitAsync(attemptId);

        await LoginAsync(StudentUsername, StudentPassword);
        var results = await _client.GetAsync("/api/v1/my/results");
        results.StatusCode.ShouldBe(HttpStatusCode.OK, await results.Content.ReadAsStringAsync());

        var body = await results.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("total").GetInt32().ShouldBe(1);

        var item = body.GetProperty("items")[0];
        item.GetProperty("attemptId").GetInt64().ShouldBe(attemptId);
        item.GetProperty("totalScore").GetDecimal().ShouldBe(10m);
        item.GetProperty("totalMax").GetDecimal().ShouldBe(20m);
        item.GetProperty("status").GetString().ShouldBe("pending_review");
    }

    [Fact]
    public async Task 别人的成绩报告看不到()
    {
        var sessionId = await CreateSessionAsync("immediately");
        var attemptId = await StartAttemptAsync(sessionId);

        await LoginAsync(TeacherUsername, TeacherPassword);
        var report = await _client.GetAsync($"/api/v1/attempts/{attemptId}/report");

        // 教师没有 attempt:read:all，看不到学生的报告。
        report.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    private static JsonElement DetailOf(JsonElement report, long questionId) =>
        report.GetProperty("details")
            .EnumerateArray()
            .First(d => d.GetProperty("questionId").GetInt64() == questionId);

    /// <summary>每份作答的保存序号：同一个序号第二次保存会被服务端当成重复丢掉。</summary>
    private readonly Dictionary<long, int> _clientSeqByAttempt = new();

    private async Task SaveAnswerAsync(long attemptId, long questionId, object payload)
    {
        var seq = _clientSeqByAttempt.TryGetValue(attemptId, out var current) ? current + 1 : 1;
        _clientSeqByAttempt[attemptId] = seq;

        var save = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/answers",
            new { clientSeq = seq, items = new[] { new { questionId, payload } } });

        save.StatusCode.ShouldBe(HttpStatusCode.OK, await save.Content.ReadAsStringAsync());
    }

    private async Task SubmitAsync(long attemptId)
    {
        var submit = await _client.PostAsJsonAsync($"/api/v1/attempts/{attemptId}/submit", new { reason = "manual" });
        submit.StatusCode.ShouldBe(HttpStatusCode.OK, await submit.Content.ReadAsStringAsync());
    }

    private async Task<long> StartAttemptAsync(long sessionId)
    {
        await LoginAsync(StudentUsername, StudentPassword);

        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { examSessionId = sessionId });
        start.StatusCode.ShouldBe(HttpStatusCode.OK, await start.Content.ReadAsStringAsync());

        var body = await start.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("attemptId").GetInt64();
    }

    private async Task<long> CreateSessionAsync(string answerPolicy)
    {
        await LoginAsync(TeacherUsername, TeacherPassword);

        var create = await _client.PostAsJsonAsync(
            "/api/v1/papers",
            new
            {
                kind = "exam",
                name = "成绩报告测试考试",
                targetTotalScore = 20,
                durationMinutes = 15,
                answerPolicy,
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

        var publishPaper = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/publish",
            new { warningOverrideReason = "本次含主观题，用于验证答案公布策略" });
        publishPaper.StatusCode.ShouldBe(HttpStatusCode.OK, await publishPaper.Content.ReadAsStringAsync());

        var session = await _client.PostAsJsonAsync(
            "/api/v1/exam-sessions",
            new
            {
                paperId,
                name = "成绩报告测试考试",
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
        question.UpdateContent("题干", "解析：选 A。", "参考答案：A。", Score.Question(10), now);

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
        question.UpdateContent("题干", "解析：说清三次握手。", "参考答案：三次握手。", Score.Question(10), now);

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

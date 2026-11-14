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
/// 成绩发布与学生端可见性。
/// <para>
/// 发布前学生只看到客观题分与「待阅」；发布之后才看得到完整成绩。
/// </para>
/// </summary>
public sealed class GradePublicationTests : IAsyncLifetime
{
    private const string TeacherUsername = "publisher01";
    private const string TeacherPassword = "Passw0rd!";
    private const string StudentUsername = "pubstudent1";
    private const string OtherStudentUsername = "pubstudent2";
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
            "publish_teacher",
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

        var studentRoleId = await SeedRoleAsync(db, "publish_student", PermissionCatalog.AttemptTake, PermissionCatalog.AttemptReadOwn);
        await SeedUserAsync(db, StudentUsername, StudentPassword, studentRoleId);
        await SeedUserAsync(db, OtherStudentUsername, StudentPassword, studentRoleId);

        _singleQuestionId = await SeedSingleQuestionAsync(db, "Q-PUB-001");
        _shortQuestionId = await SeedShortQuestionAsync(db, "Q-PUB-002");

        _sessionId = await CreateSessionAsync();
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 发布前学生只看到客观题分与待阅()
    {
        var attemptId = await StartAttemptAsync(StudentUsername);

        await SaveAnswerAsync(attemptId, _singleQuestionId, new { selectedOptionKeys = new[] { "A" } });
        await SaveAnswerAsync(attemptId, _shortQuestionId, new { text = "TCP 三次握手可以建立连接" });
        await SubmitAsync(attemptId);

        await LoginAsync(StudentUsername, StudentPassword);
        var scores = await _client.GetAsync($"/api/v1/attempts/{attemptId}/scores");
        scores.StatusCode.ShouldBe(HttpStatusCode.OK, await scores.Content.ReadAsStringAsync());

        var body = await scores.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("objectiveScore").GetDecimal().ShouldBe(10m);
        body.GetProperty("objectiveMax").GetDecimal().ShouldBe(10m);

        // 主观题的建议分不露出来：总分只算客观题那部分。
        body.GetProperty("totalScore").GetDecimal().ShouldBe(10m);
        body.GetProperty("totalMax").GetDecimal().ShouldBe(20m);
        body.GetProperty("subjectivePending").GetBoolean().ShouldBeTrue();
        body.GetProperty("gradeVisibility").GetString().ShouldBe("pending_review");

        var subjective = body.GetProperty("items")
            .EnumerateArray()
            .First(i => i.GetProperty("questionId").GetInt64() == _shortQuestionId);

        // 分是空的，命中与漏选也不给——那等于把答案抖出来。
        subjective.GetProperty("score").ValueKind.ShouldBe(JsonValueKind.Null);
        subjective.GetProperty("missedItems").GetArrayLength().ShouldBe(0);
    }

    [Fact]
    public async Task 发布全部成绩后学生看到完整成绩()
    {
        var attemptId = await StartAttemptAsync(StudentUsername);

        await SaveAnswerAsync(attemptId, _singleQuestionId, new { selectedOptionKeys = new[] { "A" } });
        await SaveAnswerAsync(attemptId, _shortQuestionId, new { text = "TCP 三次握手可以建立连接" });
        await SubmitAsync(attemptId);

        await LoginAsync(TeacherUsername, TeacherPassword);
        var publish = await _client.PostAsJsonAsync(
            $"/api/v1/exam-sessions/{_sessionId}/publish-grades",
            new { scope = "all" });

        publish.StatusCode.ShouldBe(HttpStatusCode.OK, await publish.Content.ReadAsStringAsync());

        var publishBody = await publish.Content.ReadFromJsonAsync<JsonElement>();
        publishBody.GetProperty("scope").GetString().ShouldBe("all");
        publishBody.GetProperty("scopeLabel").GetString().ShouldBe("全部成绩");
        publishBody.GetProperty("affectedAttempts").GetInt32().ShouldBe(1);

        await LoginAsync(StudentUsername, StudentPassword);
        var scores = await _client.GetAsync($"/api/v1/attempts/{attemptId}/scores");
        var body = await scores.Content.ReadFromJsonAsync<JsonElement>();

        // 主观题的建议分露出来了：10 + 5。
        body.GetProperty("totalScore").GetDecimal().ShouldBe(15m);
        body.GetProperty("totalMax").GetDecimal().ShouldBe(20m);
        body.GetProperty("gradeVisibility").GetString().ShouldBe("published");

        var subjective = body.GetProperty("items")
            .EnumerateArray()
            .First(i => i.GetProperty("questionId").GetInt64() == _shortQuestionId);

        subjective.GetProperty("score").GetDecimal().ShouldBe(5m);
        subjective.GetProperty("missedItems").GetArrayLength().ShouldBe(1);
    }

    [Fact]
    public async Task 只发布客观题时主观题仍然不露()
    {
        var attemptId = await StartAttemptAsync(StudentUsername);

        await SaveAnswerAsync(attemptId, _singleQuestionId, new { selectedOptionKeys = new[] { "A" } });
        await SaveAnswerAsync(attemptId, _shortQuestionId, new { text = "TCP 三次握手可以建立连接" });
        await SubmitAsync(attemptId);

        await LoginAsync(TeacherUsername, TeacherPassword);
        var publish = await _client.PostAsJsonAsync(
            $"/api/v1/exam-sessions/{_sessionId}/publish-grades",
            new { scope = "objective_only" });

        publish.StatusCode.ShouldBe(HttpStatusCode.OK, await publish.Content.ReadAsStringAsync());

        var publishBody = await publish.Content.ReadFromJsonAsync<JsonElement>();
        publishBody.GetProperty("scope").GetString().ShouldBe("objective_only");
        publishBody.GetProperty("scopeLabel").GetString().ShouldBe("仅客观题");

        await LoginAsync(StudentUsername, StudentPassword);
        var scores = await _client.GetAsync($"/api/v1/attempts/{attemptId}/scores");
        var body = await scores.Content.ReadFromJsonAsync<JsonElement>();

        body.GetProperty("totalScore").GetDecimal().ShouldBe(10m);
        body.GetProperty("gradeVisibility").GetString().ShouldBe("objective_only");

        var subjective = body.GetProperty("items")
            .EnumerateArray()
            .First(i => i.GetProperty("questionId").GetInt64() == _shortQuestionId);
        subjective.GetProperty("score").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task 点名发布的作答之外的看不到()
    {
        var attemptId = await StartAttemptAsync(StudentUsername);
        var otherAttemptId = await StartAttemptAsync(OtherStudentUsername);

        await LoginAsync(StudentUsername, StudentPassword);
        await SaveAnswerAsync(attemptId, _singleQuestionId, new { selectedOptionKeys = new[] { "A" } });
        await SaveAnswerAsync(attemptId, _shortQuestionId, new { text = "TCP 三次握手可以建立连接" });
        await SubmitAsync(attemptId);

        await LoginAsync(OtherStudentUsername, StudentPassword);
        await SaveAnswerAsync(otherAttemptId, _singleQuestionId, new { selectedOptionKeys = new[] { "A" } });
        await SaveAnswerAsync(otherAttemptId, _shortQuestionId, new { text = "TCP 三次握手可以建立连接" });
        await SubmitAsync(otherAttemptId);

        // 只点名第一个人的成绩。
        await LoginAsync(TeacherUsername, TeacherPassword);
        var publish = await _client.PostAsJsonAsync(
            $"/api/v1/exam-sessions/{_sessionId}/publish-grades",
            new { scope = "all", includeAttemptIds = new[] { attemptId } });

        publish.StatusCode.ShouldBe(HttpStatusCode.OK, await publish.Content.ReadAsStringAsync());

        var publishBody = await publish.Content.ReadFromJsonAsync<JsonElement>();
        publishBody.GetProperty("affectedAttempts").GetInt32().ShouldBe(1);

        // 被点名的人看到完整成绩。
        await LoginAsync(StudentUsername, StudentPassword);
        var mine = await _client.GetAsync($"/api/v1/attempts/{attemptId}/scores");
        var mineBody = await mine.Content.ReadFromJsonAsync<JsonElement>();
        mineBody.GetProperty("totalScore").GetDecimal().ShouldBe(15m);
        mineBody.GetProperty("gradeVisibility").GetString().ShouldBe("published");

        // 另一个人的成绩还没发布。
        await LoginAsync(OtherStudentUsername, StudentPassword);
        var other = await _client.GetAsync($"/api/v1/attempts/{otherAttemptId}/scores");
        var otherBody = await other.Content.ReadFromJsonAsync<JsonElement>();
        otherBody.GetProperty("totalScore").GetDecimal().ShouldBe(10m);
        otherBody.GetProperty("gradeVisibility").GetString().ShouldBe("pending_review");
    }

    [Fact]
    public async Task 场次成绩列表带发布状态()
    {
        var attemptId = await StartAttemptAsync(StudentUsername);

        await SaveAnswerAsync(attemptId, _singleQuestionId, new { selectedOptionKeys = new[] { "A" } });
        await SaveAnswerAsync(attemptId, _shortQuestionId, new { text = "TCP 三次握手可以建立连接" });
        await SubmitAsync(attemptId);

        await LoginAsync(TeacherUsername, TeacherPassword);

        var before = await _client.GetAsync($"/api/v1/exam-sessions/{_sessionId}/grades");
        before.StatusCode.ShouldBe(HttpStatusCode.OK, await before.Content.ReadAsStringAsync());

        var beforeBody = await before.Content.ReadFromJsonAsync<JsonElement>();
        beforeBody.GetProperty("total").GetInt32().ShouldBe(1);
        beforeBody.GetProperty("publishedCount").GetInt32().ShouldBe(0);

        var item = beforeBody.GetProperty("items")[0];
        item.GetProperty("attemptId").GetInt64().ShouldBe(attemptId);
        item.GetProperty("published").GetBoolean().ShouldBeFalse();
        item.GetProperty("studentUsername").GetString().ShouldBe(StudentUsername);

        // 教师看得到全部成绩：10 + 5。
        item.GetProperty("totalScore").GetDecimal().ShouldBe(15m);
        item.GetProperty("totalMax").GetDecimal().ShouldBe(20m);

        await _client.PostAsJsonAsync(
            $"/api/v1/exam-sessions/{_sessionId}/publish-grades",
            new { scope = "all" });

        var after = await _client.GetAsync($"/api/v1/exam-sessions/{_sessionId}/grades");
        var afterBody = await after.Content.ReadFromJsonAsync<JsonElement>();
        afterBody.GetProperty("publishedCount").GetInt32().ShouldBe(1);
        afterBody.GetProperty("items")[0].GetProperty("published").GetBoolean().ShouldBeTrue();
        afterBody.GetProperty("items")[0].GetProperty("gradeVisibility").GetString().ShouldBe("published");
    }

    [Fact]
    public async Task 没有发布成绩权限被拒绝()
    {
        await LoginAsync(StudentUsername, StudentPassword);
        var publish = await _client.PostAsJsonAsync(
            $"/api/v1/exam-sessions/{_sessionId}/publish-grades",
            new { scope = "all" });

        publish.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task 发布范围不合法被拒绝()
    {
        await LoginAsync(TeacherUsername, TeacherPassword);
        var publish = await _client.PostAsJsonAsync(
            $"/api/v1/exam-sessions/{_sessionId}/publish-grades",
            new { scope = "everything" });

        publish.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task 没有交卷的作答发布不了()
    {
        await LoginAsync(TeacherUsername, TeacherPassword);
        var publish = await _client.PostAsJsonAsync(
            $"/api/v1/exam-sessions/{_sessionId}/publish-grades",
            new { scope = "all" });

        publish.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);

        var problem = await publish.Content.ReadFromJsonAsync<JsonElement>();
        problem.GetProperty("detail").GetString()!.ShouldContain("交卷");
    }

    [Fact]
    public async Task 场次还没发布发布不了成绩()
    {
        var draftSessionId = await CreateSessionAsync(publishSession: false);

        await LoginAsync(TeacherUsername, TeacherPassword);
        var publish = await _client.PostAsJsonAsync(
            $"/api/v1/exam-sessions/{draftSessionId}/publish-grades",
            new { scope = "all" });

        publish.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);

        var problem = await publish.Content.ReadFromJsonAsync<JsonElement>();
        problem.GetProperty("detail").GetString()!.ShouldContain("还没发布");
    }

    [Fact]
    public async Task 发布成绩留下审计记录()
    {
        var attemptId = await StartAttemptAsync(StudentUsername);
        await SaveAnswerAsync(attemptId, _singleQuestionId, new { selectedOptionKeys = new[] { "A" } });
        await SubmitAsync(attemptId);

        await LoginAsync(TeacherUsername, TeacherPassword);
        var publish = await _client.PostAsJsonAsync(
            $"/api/v1/exam-sessions/{_sessionId}/publish-grades",
            new { scope = "all" });
        publish.StatusCode.ShouldBe(HttpStatusCode.OK);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var count = await db.Database
            .SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM audit.audit_log WHERE action = 'exam_session.publish_grades'")
            .FirstAsync();

        count.ShouldBeGreaterThanOrEqualTo(1);
    }

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

    private async Task<long> StartAttemptAsync(string username)
    {
        await LoginAsync(username, StudentPassword);

        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { examSessionId = _sessionId });
        start.StatusCode.ShouldBe(HttpStatusCode.OK, await start.Content.ReadAsStringAsync());

        var body = await start.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("attemptId").GetInt64();
    }

    private async Task<long> CreateSessionAsync(bool publishSession = true)
    {
        await LoginAsync(TeacherUsername, TeacherPassword);

        var create = await _client.PostAsJsonAsync(
            "/api/v1/papers",
            new
            {
                kind = "exam",
                name = "成绩发布测试考试",
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

        var publishPaper = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/publish",
            new { warningOverrideReason = "本次含主观题，用于验证成绩发布" });
        publishPaper.StatusCode.ShouldBe(HttpStatusCode.OK, await publishPaper.Content.ReadAsStringAsync());

        var session = await _client.PostAsJsonAsync(
            "/api/v1/exam-sessions",
            new
            {
                paperId,
                name = "成绩发布测试考试",
                openAt = DateTimeOffset.UtcNow.AddMinutes(-5),
                closeAt = DateTimeOffset.UtcNow.AddHours(4),
                durationMinutes = 90,
                participantMode = "open",
            });
        session.StatusCode.ShouldBe(HttpStatusCode.OK, await session.Content.ReadAsStringAsync());

        var sessionBody = await session.Content.ReadFromJsonAsync<JsonElement>();
        var sessionId = sessionBody.GetProperty("session").GetProperty("id").GetInt64();

        if (publishSession)
        {
            var publish = await _client.PostAsync($"/api/v1/exam-sessions/{sessionId}/publish", null);
            publish.StatusCode.ShouldBe(HttpStatusCode.OK, await publish.Content.ReadAsStringAsync());
        }

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

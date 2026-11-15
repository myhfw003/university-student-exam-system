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
/// 成绩统计读模型。
/// <para>
/// 统计必须与原始作答数据一致：这里逐项核对，并与读模型表里的行数对上。
/// </para>
/// </summary>
public sealed class ExamStatisticsTests : IAsyncLifetime
{
    private const string TeacherUsername = "statteacher1";
    private const string TeacherPassword = "Passw0rd!";
    private const string StudentOneUsername = "statstudent1";
    private const string StudentTwoUsername = "statstudent2";
    private const string StudentPassword = "Passw0rd!";

    /// <summary>试卷总分：两道单选 10 分 + 一道简答 10 分。</summary>
    private const decimal PaperTotal = 30m;

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _firstSingleQuestionId;
    private long _secondSingleQuestionId;
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
            "stat_teacher",
            PermissionCatalog.PaperRead,
            PermissionCatalog.PaperWrite,
            PermissionCatalog.PaperPublish,
            PermissionCatalog.ExamRead,
            PermissionCatalog.ExamWrite,
            PermissionCatalog.ExamPublish,
            PermissionCatalog.QuestionRead,
            PermissionCatalog.QuestionPublish,
            PermissionCatalog.TagRead,
            PermissionCatalog.ReviewGrade,
            PermissionCatalog.AnalyticsRead);

        await SeedUserAsync(db, TeacherUsername, TeacherPassword, teacherRoleId);

        var studentRoleId = await SeedRoleAsync(db, "stat_student", PermissionCatalog.AttemptTake, PermissionCatalog.AttemptReadOwn);
        await SeedUserAsync(db, StudentOneUsername, StudentPassword, studentRoleId);
        await SeedUserAsync(db, StudentTwoUsername, StudentPassword, studentRoleId);

        _firstSingleQuestionId = await SeedSingleQuestionAsync(db, "Q-STAT-001");
        _secondSingleQuestionId = await SeedSingleQuestionAsync(db, "Q-STAT-002");
        _shortQuestionId = await SeedShortQuestionAsync(db, "Q-STAT-003");

        _sessionId = await CreateSessionAsync();
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 交卷后能查到成绩分析()
    {
        await SubmitBothStudentsAsync();

        var body = await GetStatisticsAsync();

        body.GetProperty("examSessionId").GetInt64().ShouldBe(_sessionId);
        body.GetProperty("participantCount").GetInt32().ShouldBe(2);
        body.GetProperty("submittedCount").GetInt32().ShouldBe(2);
        body.GetProperty("absentCount").GetInt32().ShouldBe(0);

        // 学生一得 20 分（两道单选全对，简答没命中要点），学生二 0 分。
        body.GetProperty("averageScore").GetDecimal().ShouldBe(10m);
        body.GetProperty("maxScore").GetDecimal().ShouldBe(20m);
        body.GetProperty("minScore").GetDecimal().ShouldBe(0m);
        body.GetProperty("scoreRange").GetDecimal().ShouldBe(20m);

        // 及格线：试卷没设及格分，按六成得分率 = 18 分。学生一及格，学生二不及格。
        body.GetProperty("passRate").GetDecimal().ShouldBe(0.5m);
        // 优秀线：八五得分率 = 25.5 分，没有人达到。
        body.GetProperty("excellentRate").GetDecimal().ShouldBe(0m);

        var buckets = body.GetProperty("scoreBuckets").EnumerateArray()
            .ToDictionary(b => b.GetProperty("label").GetString()!, b => b.GetProperty("count").GetInt32());
        buckets["60–70"].ShouldBe(1);
        buckets["60 分以下"].ShouldBe(1);
        buckets["90 分以上"].ShouldBe(0);

        var questions = body.GetProperty("questionStatistics").EnumerateArray()
            .ToDictionary(q => q.GetProperty("questionId").GetInt64());
        questions.Count.ShouldBe(3);

        // 第一题：两人都作答，一人答对。
        var first = questions[_firstSingleQuestionId];
        first.GetProperty("code").GetString().ShouldBe("Q-STAT-001");
        first.GetProperty("maxScore").GetDecimal().ShouldBe(10m);
        first.GetProperty("answeredCount").GetInt32().ShouldBe(2);
        first.GetProperty("correctRate").GetDecimal().ShouldBe(0.5m);
        first.GetProperty("averageScore").GetDecimal().ShouldBe(5m);
        first.GetProperty("mastery").GetDecimal().ShouldBe(0.5m);

        // 第二题：只有学生一作答过，空白不计入分母。
        var second = questions[_secondSingleQuestionId];
        second.GetProperty("answeredCount").GetInt32().ShouldBe(1);
        second.GetProperty("correctRate").GetDecimal().ShouldBe(1m);
        second.GetProperty("averageScore").GetDecimal().ShouldBe(10m);
        second.GetProperty("mastery").GetDecimal().ShouldBe(1m);

        // 简答题：作答了但没命中要点，零分。
        var shortQuestion = questions[_shortQuestionId];
        shortQuestion.GetProperty("answeredCount").GetInt32().ShouldBe(1);
        shortQuestion.GetProperty("correctRate").GetDecimal().ShouldBe(0m);
        shortQuestion.GetProperty("mastery").GetDecimal().ShouldBe(0m);

        var types = body.GetProperty("typeStatistics").EnumerateArray()
            .ToDictionary(t => t.GetProperty("type").GetString()!);
        types.Count.ShouldBe(2);

        // 单选题：三次作答（两题 × 两人，但第二题只算一人），总得分 20。
        var single = types["single"];
        single.GetProperty("answeredCount").GetInt32().ShouldBe(3);
        single.GetProperty("averageScore").GetDecimal().ShouldBe(6.67m);
        single.GetProperty("scoreRate").GetDecimal().ShouldBe(0.6667m);

        var shortType = types["short"];
        shortType.GetProperty("answeredCount").GetInt32().ShouldBe(1);
        shortType.GetProperty("scoreRate").GetDecimal().ShouldBe(0m);
    }

    [Fact]
    public async Task 改分后统计跟着更新()
    {
        await SubmitBothStudentsAsync();

        var before = await GetStatisticsAsync();
        before.GetProperty("averageScore").GetDecimal().ShouldBe(10m);

        // 阅卷人给简答题 6 分：学生一从 20 分变成 26 分。
        await LoginAsync(TeacherUsername, TeacherPassword);
        var taskId = await LatestReviewTaskIdAsync(_shortQuestionId);
        var grade = await _client.PostAsJsonAsync(
            $"/api/v1/review-tasks/{taskId}/grade",
            new { score = 6m, comment = "要点写了一半" });
        grade.StatusCode.ShouldBe(HttpStatusCode.OK, await grade.Content.ReadAsStringAsync());

        var after = await GetStatisticsAsync();

        // (26 + 0) / 2 = 13
        after.GetProperty("averageScore").GetDecimal().ShouldBe(13m);
        after.GetProperty("maxScore").GetDecimal().ShouldBe(26m);

        var questions = after.GetProperty("questionStatistics").EnumerateArray()
            .ToDictionary(q => q.GetProperty("questionId").GetInt64());
        questions[_shortQuestionId].GetProperty("averageScore").GetDecimal().ShouldBe(6m);
        questions[_shortQuestionId].GetProperty("mastery").GetDecimal().ShouldBe(0.6m);
    }

    [Fact]
    public async Task 统计读模型按场次落库()
    {
        await SubmitBothStudentsAsync();
        await GetStatisticsAsync();

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        (await db.ExamStatistics.CountAsync(s => s.ExamSessionId == _sessionId)).ShouldBe(1);
        (await db.QuestionStatistics.CountAsync(s => s.ExamSessionId == _sessionId)).ShouldBe(3);
        (await db.TypeStatistics.CountAsync(s => s.ExamSessionId == _sessionId)).ShouldBe(2);

        var statistic = await db.ExamStatistics.AsNoTracking()
            .FirstAsync(s => s.ExamSessionId == _sessionId);
        statistic.SubmittedCount.ShouldBe(2);
        statistic.AverageScore.ShouldBe(10m);

        // 再查一次，结果不变：读模型不是每次查询都重算。
        var again = await GetStatisticsAsync();
        again.GetProperty("averageScore").GetDecimal().ShouldBe(10m);
    }

    [Fact]
    public async Task 学生没有分析权限时拿不到统计()
    {
        await SubmitBothStudentsAsync();

        await LoginAsync(StudentOneUsername, StudentPassword);
        var response = await _client.GetAsync($"/api/v1/statistics/exam-sessions/{_sessionId}");

        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    private async Task<JsonElement> GetStatisticsAsync()
    {
        await LoginAsync(TeacherUsername, TeacherPassword);

        var response = await _client.GetAsync($"/api/v1/statistics/exam-sessions/{_sessionId}");
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    /// <summary>学生一：两道单选全对，简答写了但没命中要点。学生二：第一题答错，其余留白。</summary>
    private async Task SubmitBothStudentsAsync()
    {
        await LoginAsync(StudentOneUsername, StudentPassword);
        var first = await StartAttemptAsync();
        await SaveAnswerAsync(first, _firstSingleQuestionId, new { selectedOptionKeys = new[] { "A" } });
        await SaveAnswerAsync(first, _secondSingleQuestionId, new { selectedOptionKeys = new[] { "A" } });
        await SaveAnswerAsync(first, _shortQuestionId, new { text = "不知道" });
        await SubmitAsync(first);

        await LoginAsync(StudentTwoUsername, StudentPassword);
        var second = await StartAttemptAsync();
        await SaveAnswerAsync(second, _firstSingleQuestionId, new { selectedOptionKeys = new[] { "B" } });
        await SubmitAsync(second);
    }

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

    private async Task<long> StartAttemptAsync()
    {
        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { examSessionId = _sessionId });
        start.StatusCode.ShouldBe(HttpStatusCode.OK, await start.Content.ReadAsStringAsync());

        var body = await start.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("attemptId").GetInt64();
    }

    private async Task<long> LatestReviewTaskIdAsync(long questionId)
    {
        var list = await _client.GetAsync("/api/v1/review-tasks");
        list.StatusCode.ShouldBe(HttpStatusCode.OK, await list.Content.ReadAsStringAsync());

        var body = await list.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray().ToList();
        var task = items.Single(t => t.GetProperty("questionId").GetInt64() == questionId);
        return task.GetProperty("id").GetInt64();
    }

    private async Task<long> CreateSessionAsync()
    {
        await LoginAsync(TeacherUsername, TeacherPassword);

        var create = await _client.PostAsJsonAsync(
            "/api/v1/papers",
            new
            {
                kind = "exam",
                name = "统计读模型测试考试",
                targetTotalScore = PaperTotal,
                durationMinutes = 15,
                allowRetake = false,
            });
        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var paperBody = await create.Content.ReadFromJsonAsync<JsonElement>();
        var paperId = paperBody.GetProperty("paper").GetProperty("id").GetInt64();

        foreach (var questionId in new[] { _firstSingleQuestionId, _secondSingleQuestionId, _shortQuestionId })
        {
            var add = await _client.PostAsJsonAsync(
                $"/api/v1/papers/{paperId}/items",
                new { questionId, score = 10m });
            add.StatusCode.ShouldBe(HttpStatusCode.OK, await add.Content.ReadAsStringAsync());
        }

        var publishPaper = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/publish",
            new { warningOverrideReason = "本次含主观题，用于验证统计读模型" });
        publishPaper.StatusCode.ShouldBe(HttpStatusCode.OK, await publishPaper.Content.ReadAsStringAsync());

        var session = await _client.PostAsJsonAsync(
            "/api/v1/exam-sessions",
            new
            {
                paperId,
                name = "统计读模型测试考试",
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
        var question = Question.CreateDraft(code, QuestionType.Short, "简述 TCP 三次握手", Score.Question(10), 1, now);
        question.AddKeypoint(QuestionKeypoint.Create("三次握手", ["三次", "握手"], 0), now);

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

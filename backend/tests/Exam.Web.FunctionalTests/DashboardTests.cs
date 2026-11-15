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
/// 学生工作台汇总。
/// <para>
/// 工作台上的每一个数字都来自真实的作答数据：成绩、错题、进行中的考试。
/// </para>
/// </summary>
public sealed class DashboardTests : IAsyncLifetime
{
    private const string TeacherUsername = "dashteacher1";
    private const string TeacherPassword = "Passw0rd!";
    private const string StudentUsername = "dashstudent1";
    private const string IdleUsername = "dashstudent2";
    private const string StudentPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _firstQuestionId;
    private long _secondQuestionId;
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
            "dash_teacher",
            PermissionCatalog.PaperRead,
            PermissionCatalog.PaperWrite,
            PermissionCatalog.PaperPublish,
            PermissionCatalog.ExamRead,
            PermissionCatalog.ExamWrite,
            PermissionCatalog.ExamPublish,
            PermissionCatalog.QuestionRead,
            PermissionCatalog.QuestionPublish,
            PermissionCatalog.TagRead);

        await SeedUserAsync(db, TeacherUsername, TeacherPassword, teacherRoleId);

        var studentRoleId = await SeedRoleAsync(db, "dash_student", PermissionCatalog.AttemptTake, PermissionCatalog.AttemptReadOwn);
        await SeedUserAsync(db, StudentUsername, StudentPassword, studentRoleId);
        await SeedUserAsync(db, IdleUsername, StudentPassword, studentRoleId);

        // 难度标签与知识点标签各建一个：题目的难度走难度入口，知识点用于错题分布分组。
        var difficultyTagId = await SeedTagAsync(db, "dash.difficulty", "基础", TagGroup.Difficulty, 1);
        var knowledgeTagId = await SeedTagAsync(db, "dash.network", "计算机网络", TagGroup.KnowledgePoint, null);

        _firstQuestionId = await SeedSingleQuestionAsync(db, "Q-DASH-001", difficultyTagId);
        _secondQuestionId = await SeedSingleQuestionAsync(db, "Q-DASH-002", difficultyTagId, knowledgeTagId);

        _sessionId = await CreateSessionAsync();
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 工作台汇总带成绩趋势与错题分布()
    {
        await SubmitAsync(StudentUsername);

        // 交卷即定分：派发之后错题才进错题本。
        await DispatchAsync();

        await LoginAsync(StudentUsername, StudentPassword);
        var body = await GetSummaryAsync();

        // 一道答对一道答错：总分 10 / 20。
        body.GetProperty("pendingMistakes").GetInt32().ShouldBe(1);
        body.GetProperty("termAverageScore").GetDecimal().ShouldBe(50m);
        body.GetProperty("ongoingExams").GetInt32().ShouldBe(1);

        var ongoing = body.GetProperty("ongoingExam");
        ongoing.GetProperty("examSessionId").GetInt64().ShouldBe(_sessionId);
        ongoing.GetProperty("started").GetBoolean().ShouldBeTrue();

        var results = body.GetProperty("recentResults").EnumerateArray().ToList();
        results.Count.ShouldBe(1);
        results[0].GetProperty("kind").GetString().ShouldBe("exam");
        results[0].GetProperty("score").GetDecimal().ShouldBe(10m);
        results[0].GetProperty("total").GetDecimal().ShouldBe(20m);

        var trend = body.GetProperty("scoreTrend").EnumerateArray().ToList();
        trend.Count.ShouldBe(1);
        trend[0].GetProperty("score").GetDecimal().ShouldBe(10m);
        trend[0].GetProperty("total").GetDecimal().ShouldBe(20m);

        var distribution = body.GetProperty("mistakeDistribution").EnumerateArray().ToList();
        distribution.Count.ShouldBe(1);
        distribution[0].GetProperty("tagName").GetString().ShouldBe("计算机网络");
        distribution[0].GetProperty("count").GetInt32().ShouldBe(1);
    }

    [Fact]
    public async Task 什么数据都没有时工作台给空态()
    {
        await LoginAsync(IdleUsername, StudentPassword);
        var body = await GetSummaryAsync();

        body.GetProperty("pendingPractices").GetInt32().ShouldBe(0);
        body.GetProperty("pendingMistakes").GetInt32().ShouldBe(0);
        body.GetProperty("termAverageScore").ValueKind.ShouldBe(JsonValueKind.Null);
        body.GetProperty("recentResults").GetArrayLength().ShouldBe(0);
        body.GetProperty("scoreTrend").GetArrayLength().ShouldBe(0);
        body.GetProperty("mistakeDistribution").GetArrayLength().ShouldBe(0);
        body.GetProperty("recommendedPractices").GetArrayLength().ShouldBe(0);

        // 考试还在进行中，空态也要给出「正在进行的考试」，前端好放引导按钮。
        body.GetProperty("ongoingExam").GetProperty("examSessionId").GetInt64().ShouldBe(_sessionId);
    }

    private async Task<JsonElement> GetSummaryAsync()
    {
        var response = await _client.GetAsync("/api/v1/dashboard/summary");
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private async Task SubmitAsync(string username)
    {
        await LoginAsync(username, StudentPassword);

        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { examSessionId = _sessionId });
        start.StatusCode.ShouldBe(HttpStatusCode.OK, await start.Content.ReadAsStringAsync());

        var body = await start.Content.ReadFromJsonAsync<JsonElement>();
        var attemptId = body.GetProperty("attemptId").GetInt64();

        // 第一题答对，第二题答错。
        await SaveAnswerAsync(attemptId, _firstQuestionId, new { selectedOptionKeys = new[] { "A" } }, 1);
        await SaveAnswerAsync(attemptId, _secondQuestionId, new { selectedOptionKeys = new[] { "B" } }, 2);

        var submit = await _client.PostAsJsonAsync($"/api/v1/attempts/{attemptId}/submit", new { reason = "manual" });
        submit.StatusCode.ShouldBe(HttpStatusCode.OK, await submit.Content.ReadAsStringAsync());
    }

    private async Task SaveAnswerAsync(long attemptId, long questionId, object payload, int seq)
    {
        var save = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/answers",
            new { clientSeq = seq, items = new[] { new { questionId, payload } } });

        save.StatusCode.ShouldBe(HttpStatusCode.OK, await save.Content.ReadAsStringAsync());
    }

    /// <summary>派发 Outbox 里的领域事件（Worker 在生产里干这件事）。</summary>
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
                name = "工作台测试考试",
                targetTotalScore = 20,
                durationMinutes = 15,
                allowRetake = false,
            });
        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var paperBody = await create.Content.ReadFromJsonAsync<JsonElement>();
        var paperId = paperBody.GetProperty("paper").GetProperty("id").GetInt64();

        foreach (var questionId in new[] { _firstQuestionId, _secondQuestionId })
        {
            var add = await _client.PostAsJsonAsync(
                $"/api/v1/papers/{paperId}/items",
                new { questionId, score = 10m });
            add.StatusCode.ShouldBe(HttpStatusCode.OK, await add.Content.ReadAsStringAsync());
        }

        var publishPaper = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/publish",
            new { warningOverrideReason = "用于验证工作台汇总" });
        publishPaper.StatusCode.ShouldBe(HttpStatusCode.OK, await publishPaper.Content.ReadAsStringAsync());

        var session = await _client.PostAsJsonAsync(
            "/api/v1/exam-sessions",
            new
            {
                paperId,
                name = "工作台测试考试",
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

    private static async Task<long> SeedTagAsync(AppDbContext db, string code, string name, TagGroup group, int? level)
    {
        var now = DateTimeOffset.UtcNow;
        var tag = Tag.Create(code, name, group, level, null, 0, now);

        await db.Tags.AddAsync(tag);
        await db.SaveChangesAsync();

        return tag.Id;
    }

    private static async Task<long> SeedSingleQuestionAsync(
        AppDbContext db,
        string code,
        long difficultyTagId,
        long? knowledgeTagId = null)
    {
        var now = DateTimeOffset.UtcNow;
        var question = Question.CreateDraft(code, QuestionType.Single, "题干", Score.Question(10), difficultyTagId, now);
        question.AddOption(QuestionOption.Create("A", "甲", true, 0), now);
        question.AddOption(QuestionOption.Create("B", "乙", false, 1), now);

        if (knowledgeTagId is not null)
        {
            question.AttachTag(knowledgeTagId.Value, now);
        }

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

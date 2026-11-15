using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Exam.Application.Messaging;
using Exam.Domain.Catalog;
using Exam.Domain.Identity;
using Exam.Domain.Learning;
using Exam.Infrastructure.Identity;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;
using Testcontainers.PostgreSql;

namespace Exam.Web.FunctionalTests;

/// <summary>
/// 练习规则执行。
/// <para>
/// 练习与考试的规则差异：练习**不计时、不强制交卷、不限制切屏**，
/// 次数用尽不给开新会话，反馈时机与错题回流由练习规则说了算。
/// </para>
/// </summary>
public sealed class PracticeSessionTests : IAsyncLifetime
{
    private const string TeacherUsername = "praceteacher2";
    private const string TeacherPassword = "Passw0rd!";
    private const string StudentUsername = "pracestudent3";
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
            "practice_teacher2",
            PermissionCatalog.PaperRead,
            PermissionCatalog.PaperWrite,
            PermissionCatalog.PaperPublish,
            PermissionCatalog.QuestionRead,
            PermissionCatalog.QuestionPublish);

        await SeedUserAsync(db, TeacherUsername, TeacherPassword, teacherRoleId);

        var studentRoleId = await SeedRoleAsync(db, "practice_student2", PermissionCatalog.AttemptTake, PermissionCatalog.AttemptReadOwn);
        await SeedUserAsync(db, StudentUsername, StudentPassword, studentRoleId);

        var now = DateTimeOffset.UtcNow;
        foreach (var code in new[] { "Q-PSE-001", "Q-PSE-002" })
        {
            var question = Question.CreateDraft(code, QuestionType.Single, "题干", Score.Question(10), 1, now);
            question.AddOption(QuestionOption.Create("A", "甲", true, 0), now);
            question.AddOption(QuestionOption.Create("B", "乙", false, 1), now);

            await db.Questions.AddAsync(question);
            await db.SaveChangesAsync();

            question.Publish(now);
            await db.SaveChangesAsync();

            if (_firstQuestionId == 0)
            {
                _firstQuestionId = question.Id;
            }
            else
            {
                _secondQuestionId = question.Id;
            }
        }
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 练习会话不计时也不强制交卷()
    {
        var assignmentId = await CreatePracticeAsync(maxAttempts: 0, feedbackTiming: "after_submit", reflowMistakes: true);
        await LoginAsync(StudentUsername, StudentPassword);

        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { practiceAssignmentId = assignmentId });
        start.StatusCode.ShouldBe(HttpStatusCode.OK, await start.Content.ReadAsStringAsync());

        var body = await start.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("targetType").GetString().ShouldBe("practice");
        body.GetProperty("timed").GetBoolean().ShouldBeFalse();
        body.GetProperty("practiceRules").GetProperty("feedbackTiming").GetString().ShouldBe("after_submit");

        var attemptId = body.GetProperty("attemptId").GetInt64();

        // 切屏十几次：练习不限制切屏，也不会被强制交卷。
        for (var i = 0; i < 12; i++)
        {
            var focus = await _client.PostAsJsonAsync(
                $"/api/v1/attempts/{attemptId}/focus-events",
                new { events = new[] { new { type = "window_blur", clientAt = DateTimeOffset.UtcNow } } });
            focus.StatusCode.ShouldBe(HttpStatusCode.OK, await focus.Content.ReadAsStringAsync());

            var focusBody = await focus.Content.ReadFromJsonAsync<JsonElement>();
            focusBody.GetProperty("forcedSubmit").GetBoolean().ShouldBeFalse();
            focusBody.GetProperty("limitReached").GetBoolean().ShouldBeFalse();
        }

        // 会话还在进行中，没有被强制交卷。
        var state = await _client.GetAsync($"/api/v1/attempts/{attemptId}");
        state.StatusCode.ShouldBe(HttpStatusCode.OK, await state.Content.ReadAsStringAsync());

        var stateBody = await state.Content.ReadFromJsonAsync<JsonElement>();
        stateBody.GetProperty("status").GetString().ShouldBe("in_progress");
    }

    [Fact]
    public async Task 次数用尽不能再开新会话()
    {
        var assignmentId = await CreatePracticeAsync(maxAttempts: 1, feedbackTiming: "after_submit", reflowMistakes: true);
        await LoginAsync(StudentUsername, StudentPassword);

        var first = await _client.PostAsJsonAsync("/api/v1/attempts", new { practiceAssignmentId = assignmentId });
        first.StatusCode.ShouldBe(HttpStatusCode.OK, await first.Content.ReadAsStringAsync());

        var firstBody = await first.Content.ReadFromJsonAsync<JsonElement>();
        var attemptId = firstBody.GetProperty("attemptId").GetInt64();

        var submit = await _client.PostAsJsonAsync($"/api/v1/attempts/{attemptId}/submit", new { reason = "manual" });
        submit.StatusCode.ShouldBe(HttpStatusCode.OK, await submit.Content.ReadAsStringAsync());

        // 次数用尽：不再给开新的会话，并给出提示。
        var second = await _client.PostAsJsonAsync("/api/v1/attempts", new { practiceAssignmentId = assignmentId });
        second.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);

        var problem = await second.Content.ReadFromJsonAsync<JsonElement>();
        problem.GetProperty("title").GetString()!.ShouldContain("练习次数已用完");
    }

    [Fact]
    public async Task 即时反馈能立刻看到对错()
    {
        var assignmentId = await CreatePracticeAsync(maxAttempts: 0, feedbackTiming: "immediate", reflowMistakes: true);
        await LoginAsync(StudentUsername, StudentPassword);

        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { practiceAssignmentId = assignmentId });
        start.StatusCode.ShouldBe(HttpStatusCode.OK, await start.Content.ReadAsStringAsync());

        var body = await start.Content.ReadFromJsonAsync<JsonElement>();
        var attemptId = body.GetProperty("attemptId").GetInt64();

        // 第一题答对，第二题答错。
        var save = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/answers",
            new
            {
                clientSeq = 1,
                items = new object[]
                {
                    new { questionId = _firstQuestionId, payload = new { selectedOptionKeys = new[] { "A" } } },
                    new { questionId = _secondQuestionId, payload = new { selectedOptionKeys = new[] { "B" } } },
                },
            });
        save.StatusCode.ShouldBe(HttpStatusCode.OK, await save.Content.ReadAsStringAsync());

        // 还没交卷就能看到对错。
        var feedback = await _client.PostAsJsonAsync($"/api/v1/attempts/{attemptId}/feedback", new { });
        feedback.StatusCode.ShouldBe(HttpStatusCode.OK, await feedback.Content.ReadAsStringAsync());

        var feedbackBody = await feedback.Content.ReadFromJsonAsync<JsonElement>();
        feedbackBody.GetProperty("feedbackTiming").GetString().ShouldBe("immediate");

        var questions = feedbackBody.GetProperty("questions").EnumerateArray()
            .ToDictionary(q => q.GetProperty("questionId").GetInt64());

        var first = questions[_firstQuestionId];
        first.GetProperty("answered").GetBoolean().ShouldBeTrue();
        first.GetProperty("correct").GetBoolean().ShouldBeTrue();
        first.GetProperty("score").GetDecimal().ShouldBe(10m);
        first.GetProperty("correctKeys").EnumerateArray().Select(k => k.GetString()).ShouldContain("A");

        var second = questions[_secondQuestionId];
        second.GetProperty("correct").GetBoolean().ShouldBeFalse();
        second.GetProperty("score").GetDecimal().ShouldBe(0m);
    }

    [Fact]
    public async Task 提交后才给反馈()
    {
        var assignmentId = await CreatePracticeAsync(maxAttempts: 0, feedbackTiming: "after_submit", reflowMistakes: true);
        await LoginAsync(StudentUsername, StudentPassword);

        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { practiceAssignmentId = assignmentId });
        start.StatusCode.ShouldBe(HttpStatusCode.OK, await start.Content.ReadAsStringAsync());

        var body = await start.Content.ReadFromJsonAsync<JsonElement>();
        var attemptId = body.GetProperty("attemptId").GetInt64();

        // 没交卷不给反馈。
        var early = await _client.PostAsJsonAsync($"/api/v1/attempts/{attemptId}/feedback", new { });
        early.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);

        var submit = await _client.PostAsJsonAsync($"/api/v1/attempts/{attemptId}/submit", new { reason = "manual" });
        submit.StatusCode.ShouldBe(HttpStatusCode.OK, await submit.Content.ReadAsStringAsync());

        var feedback = await _client.PostAsJsonAsync($"/api/v1/attempts/{attemptId}/feedback", new { });
        feedback.StatusCode.ShouldBe(HttpStatusCode.OK, await feedback.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task 练习可以关掉错题回流()
    {
        var assignmentId = await CreatePracticeAsync(maxAttempts: 0, feedbackTiming: "after_submit", reflowMistakes: false);
        await LoginAsync(StudentUsername, StudentPassword);

        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { practiceAssignmentId = assignmentId });
        start.StatusCode.ShouldBe(HttpStatusCode.OK, await start.Content.ReadAsStringAsync());

        var body = await start.Content.ReadFromJsonAsync<JsonElement>();
        var attemptId = body.GetProperty("attemptId").GetInt64();

        var save = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/answers",
            new
            {
                clientSeq = 1,
                items = new[]
                {
                    new { questionId = _firstQuestionId, payload = new { selectedOptionKeys = new[] { "B" } } },
                },
            });
        save.StatusCode.ShouldBe(HttpStatusCode.OK, await save.Content.ReadAsStringAsync());

        var submit = await _client.PostAsJsonAsync($"/api/v1/attempts/{attemptId}/submit", new { reason = "manual" });
        submit.StatusCode.ShouldBe(HttpStatusCode.OK, await submit.Content.ReadAsStringAsync());

        await DispatchAsync();

        // 规则说不回流，错题本里就没有这道题。
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        (await db.Mistakes.CountAsync()).ShouldBe(0);
    }

    /// <summary>建一份练习：试卷（带规则）+ 开放单。</summary>
    private async Task<long> CreatePracticeAsync(int maxAttempts, string feedbackTiming, bool reflowMistakes)
    {
        await LoginAsync(TeacherUsername, TeacherPassword);

        var create = await _client.PostAsJsonAsync(
            "/api/v1/papers",
            new
            {
                kind = "practice",
                name = "练习规则测试卷",
                targetTotalScore = 20,
                durationMinutes = 30,
                practiceRules = new
                {
                    maxAttempts,
                    feedbackTiming,
                    reflowMistakes,
                    suggestedMinutes = 30,
                },
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

        var publish = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/publish",
            new { warningOverrideReason = "用于验证练习规则" });
        publish.StatusCode.ShouldBe(HttpStatusCode.OK, await publish.Content.ReadAsStringAsync());

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var now = DateTimeOffset.UtcNow;

        var assignment = PracticeAssignment.Create(paperId, "练习规则测试", [], now, null, now);
        assignment.Publish(now);

        await db.PracticeAssignments.AddAsync(assignment);
        await db.SaveChangesAsync();

        return assignment.Id;
    }

    private async Task DispatchAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var dispatcher = scope.ServiceProvider.GetRequiredService<IDomainEventDispatcher>();
        await dispatcher.DispatchPendingAsync();
    }

    private async Task LoginAsync(string username, string password)
    {
        var response = await _client.PostAsJsonAsync("/api/v1/auth/login", new { username, password });
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        _client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", body.GetProperty("accessToken").GetString());
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

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Exam.Domain.Catalog;
using Exam.Domain.Delivery;
using Exam.Domain.Identity;
using Exam.Infrastructure.Identity;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;
using Testcontainers.PostgreSql;

namespace Exam.Web.FunctionalTests;

/// <summary>焦点事件采集与策略判定的端到端测试。</summary>
public sealed class FocusEventEndpointTests : IAsyncLifetime
{
    private const string TeacherUsername = "focusteacher1";
    private const string TeacherPassword = "Passw0rd!";
    private const string StudentUsername = "focusstudent1";
    private const string StudentPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _questionId;

    public async Task InitializeAsync()
    {
        await _postgres.StartAsync();

        _factory = new ExamWebFactory(_postgres.GetConnectionString());
        _client = _factory.CreateClient();
        _client.BaseAddress = new Uri("http://localhost");

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.MigrateAsync();

        var teacherRoleId = await SeedRoleAsync(db, "focus_teacher", PermissionCatalog.ExamRead, PermissionCatalog.ExamWrite, PermissionCatalog.ExamPublish, PermissionCatalog.PaperRead, PermissionCatalog.PaperWrite, PermissionCatalog.PaperPublish, PermissionCatalog.QuestionRead, PermissionCatalog.QuestionPublish, PermissionCatalog.TagRead);
        await SeedUserAsync(db, TeacherUsername, TeacherPassword, teacherRoleId);

        var studentRoleId = await SeedRoleAsync(db, "focus_student", PermissionCatalog.AttemptTake, PermissionCatalog.AttemptReadOwn);
        await SeedUserAsync(db, StudentUsername, StudentPassword, studentRoleId);

        _questionId = await SeedQuestionAsync(db, "Q-FCS-001");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 切屏计数由服务端累加()
    {
        var attemptId = await StartAttemptAsync(maxFocusLoss: 3, onMaxFocusLoss: "warn");

        var report = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/focus-events",
            new
            {
                events = new[]
                {
                    new { type = "window_blur" },
                    new { type = "page_hidden" },
                },
            });

        report.StatusCode.ShouldBe(HttpStatusCode.OK, await report.Content.ReadAsStringAsync());

        var body = await report.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("focusLossCount").GetInt32().ShouldBe(2);
        body.GetProperty("limit").GetInt32().ShouldBe(3);
        body.GetProperty("limitReached").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task 复制粘贴不计入切屏次数()
    {
        var attemptId = await StartAttemptAsync(maxFocusLoss: 3, onMaxFocusLoss: "warn");

        var report = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/focus-events",
            new
            {
                events = new[]
                {
                    new { type = "copy_attempt" },
                    new { type = "paste_attempt" },
                    new { type = "context_menu" },
                },
            });

        report.StatusCode.ShouldBe(HttpStatusCode.OK, await report.Content.ReadAsStringAsync());

        var body = await report.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("focusLossCount").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task 达到切屏上限按策略强制交卷()
    {
        var attemptId = await StartAttemptAsync(maxFocusLoss: 2, onMaxFocusLoss: "force_submit");

        var report = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/focus-events",
            new
            {
                events = new[]
                {
                    new { type = "window_blur" },
                    new { type = "window_blur" },
                },
            });

        report.StatusCode.ShouldBe(HttpStatusCode.OK, await report.Content.ReadAsStringAsync());

        var body = await report.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("focusLossCount").GetInt32().ShouldBe(2);
        body.GetProperty("limitReached").GetBoolean().ShouldBeTrue();
        body.GetProperty("forcedSubmit").GetBoolean().ShouldBeTrue();

        // 强制交卷后拒绝继续保存答案。
        var save = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/answers",
            new
            {
                clientSeq = 1,
                items = new[]
                {
                    new { questionId = _questionId, payload = new { selectedOptionKeys = new[] { "A" } } },
                },
            });
        save.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task 达到切屏上限按警告策略只记警告()
    {
        var attemptId = await StartAttemptAsync(maxFocusLoss: 2, onMaxFocusLoss: "warn");

        var report = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/focus-events",
            new
            {
                events = new[]
                {
                    new { type = "window_blur" },
                    new { type = "window_blur" },
                },
            });

        report.StatusCode.ShouldBe(HttpStatusCode.OK, await report.Content.ReadAsStringAsync());

        var body = await report.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("limitReached").GetBoolean().ShouldBeTrue();
        body.GetProperty("forcedSubmit").GetBoolean().ShouldBeFalse();
        body.GetProperty("warned").GetBoolean().ShouldBeTrue();
        body.GetProperty("warningCount").GetInt32().ShouldBe(1);
    }

    [Fact]
    public async Task 焦点事件会留下流水()
    {
        var attemptId = await StartAttemptAsync(maxFocusLoss: 3, onMaxFocusLoss: "warn");

        await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/focus-events",
            new
            {
                events = new[]
                {
                    new { type = "window_blur", questionId = (long?)_questionId },
                    new { type = "copy_attempt", questionId = (long?)null },
                },
            });

        var events = await LoadFocusEventsAsync(attemptId);
        events.Count.ShouldBe(2);
        events[0].EventType.ShouldBe("window_blur");
        events[1].EventType.ShouldBe("copy_attempt");
    }

    private async Task<IReadOnlyList<FocusEventRow>> LoadFocusEventsAsync(long attemptId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        return await db.Set<FocusEvent>()
            .AsNoTracking()
            .Where(e => e.AttemptId == attemptId)
            .OrderBy(e => e.Id)
            .Select(e => new FocusEventRow(e.Id, e.EventType.ToStorage()))
            .ToListAsync();
    }

    private sealed record FocusEventRow(long Id, string EventType);

    private async Task<long> StartAttemptAsync(int maxFocusLoss, string onMaxFocusLoss)
    {
        await LoginAsync(TeacherUsername, TeacherPassword);
        var sessionId = await CreateSessionAsync(maxFocusLoss, onMaxFocusLoss);

        await LoginAsync(StudentUsername, StudentPassword);

        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { examSessionId = sessionId });
        start.StatusCode.ShouldBe(HttpStatusCode.OK, await start.Content.ReadAsStringAsync());

        var body = await start.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("attemptId").GetInt64();
    }

    private async Task<long> CreateSessionAsync(int maxFocusLoss, string onMaxFocusLoss)
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

        var paperBody = await create.Content.ReadFromJsonAsync<JsonElement>();
        var paperId = paperBody.GetProperty("paper").GetProperty("id").GetInt64();

        var add = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/items",
            new { questionId = _questionId, score = 10m });
        add.StatusCode.ShouldBe(HttpStatusCode.OK, await add.Content.ReadAsStringAsync());

        var publishPaper = await _client.PostAsync($"/api/v1/papers/{paperId}/publish", null);
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
                rules = new
                {
                    maxFocusLoss,
                    onMaxFocusLoss,
                },
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

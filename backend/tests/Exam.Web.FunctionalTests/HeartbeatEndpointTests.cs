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

/// <summary>心跳与断连检测的端到端测试。</summary>
public sealed class HeartbeatEndpointTests : IAsyncLifetime
{
    private const string TeacherUsername = "heartteacher1";
    private const string TeacherPassword = "Passw0rd!";
    private const string StudentUsername = "heartstudent1";
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

        var teacherRoleId = await SeedRoleAsync(db, "heart_teacher", PermissionCatalog.ExamRead, PermissionCatalog.ExamWrite, PermissionCatalog.ExamPublish, PermissionCatalog.PaperRead, PermissionCatalog.PaperWrite, PermissionCatalog.PaperPublish, PermissionCatalog.QuestionRead, PermissionCatalog.QuestionPublish, PermissionCatalog.TagRead);
        await SeedUserAsync(db, TeacherUsername, TeacherPassword, teacherRoleId);

        var studentRoleId = await SeedRoleAsync(db, "heart_student", PermissionCatalog.AttemptTake, PermissionCatalog.AttemptReadOwn);
        await SeedUserAsync(db, StudentUsername, StudentPassword, studentRoleId);

        _questionId = await SeedQuestionAsync(db, "Q-HBT-001");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 心跳正常返回服务端时间与剩余秒数()
    {
        var attemptId = await StartAttemptAsync(maxDisconnect: 1);

        var heartbeat = await _client.PostAsync($"/api/v1/attempts/{attemptId}/heartbeat", null);
        heartbeat.StatusCode.ShouldBe(HttpStatusCode.OK, await heartbeat.Content.ReadAsStringAsync());

        var body = await heartbeat.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("disconnectCount").GetInt32().ShouldBe(0);
        body.GetProperty("remainingSeconds").GetInt64().ShouldBeGreaterThan(0);
        body.GetProperty("status").GetString().ShouldBe("in_progress");
        body.GetProperty("submitted").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task 断网超时后计数一次断连()
    {
        var attemptId = await StartAttemptAsync(maxDisconnect: 5);

        await _client.PostAsync($"/api/v1/attempts/{attemptId}/heartbeat", null);

        // 模拟断网 60 秒：把上一次心跳挪到过去。
        await SetLastHeartbeatAsync(attemptId, DateTimeOffset.UtcNow.AddSeconds(-60));

        var heartbeat = await _client.PostAsync($"/api/v1/attempts/{attemptId}/heartbeat", null);
        heartbeat.StatusCode.ShouldBe(HttpStatusCode.OK, await heartbeat.Content.ReadAsStringAsync());

        var body = await heartbeat.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("disconnectCount").GetInt32().ShouldBe(1);
        body.GetProperty("submitted").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task 断连次数超过上限按断网超时代交()
    {
        var attemptId = await StartAttemptAsync(maxDisconnect: 1);

        await _client.PostAsync($"/api/v1/attempts/{attemptId}/heartbeat", null);
        await SetLastHeartbeatAsync(attemptId, DateTimeOffset.UtcNow.AddSeconds(-60));
        await _client.PostAsync($"/api/v1/attempts/{attemptId}/heartbeat", null);

        await SetLastHeartbeatAsync(attemptId, DateTimeOffset.UtcNow.AddSeconds(-60));
        var heartbeat = await _client.PostAsync($"/api/v1/attempts/{attemptId}/heartbeat", null);
        heartbeat.StatusCode.ShouldBe(HttpStatusCode.OK, await heartbeat.Content.ReadAsStringAsync());

        var body = await heartbeat.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("disconnectCount").GetInt32().ShouldBe(2);
        body.GetProperty("submitted").GetBoolean().ShouldBeTrue();
        body.GetProperty("submitReason").GetString().ShouldBe("network_timeout");
    }

    [Fact]
    public async Task 同一次断网不会被重复计数()
    {
        var attemptId = await StartAttemptAsync(maxDisconnect: 5);

        await _client.PostAsync($"/api/v1/attempts/{attemptId}/heartbeat", null);
        await SetLastHeartbeatAsync(attemptId, DateTimeOffset.UtcNow.AddSeconds(-60));

        await _client.PostAsync($"/api/v1/attempts/{attemptId}/heartbeat", null);

        // 心跳已经恢复，再连一次不应该重复计数。
        var heartbeat = await _client.PostAsync($"/api/v1/attempts/{attemptId}/heartbeat", null);
        var body = await heartbeat.Content.ReadFromJsonAsync<JsonElement>();

        body.GetProperty("disconnectCount").GetInt32().ShouldBe(1);
    }

    private async Task SetLastHeartbeatAsync(long attemptId, DateTimeOffset at)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE delivery.attempt SET last_heartbeat_at = {at} WHERE id = {attemptId}");
    }

    private async Task<long> StartAttemptAsync(int maxDisconnect)
    {
        await LoginAsync(TeacherUsername, TeacherPassword);
        var sessionId = await CreateSessionAsync(maxDisconnect);

        await LoginAsync(StudentUsername, StudentPassword);

        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { examSessionId = sessionId });
        start.StatusCode.ShouldBe(HttpStatusCode.OK, await start.Content.ReadAsStringAsync());

        var body = await start.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("attemptId").GetInt64();
    }

    private async Task<long> CreateSessionAsync(int maxDisconnect)
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
                    heartbeatIntervalSeconds = 15,
                    heartbeatTimeoutSeconds = 45,
                    maxDisconnect,
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

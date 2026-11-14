using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Exam.Application.Delivery.Contracts;
using Exam.Domain.Catalog;
using Exam.Domain.Identity;
using Exam.Infrastructure.Identity;
using Exam.Infrastructure.Persistence;
using Exam.Web.Hubs;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;
using Testcontainers.PostgreSql;
using Testcontainers.Redis;

namespace Exam.Web.FunctionalTests;

/// <summary>监考状态聚合与实时推送的端到端测试。</summary>
public sealed class ExamMonitoringTests : IAsyncLifetime
{
    private const string ProctorUsername = "monitorproctor1";
    private const string ProctorPassword = "Passw0rd!";
    private const string StudentUsername = "monitorstudent1";
    private const string StudentPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private readonly RedisContainer _redis = new RedisBuilder("redis:7-alpine").Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _questionId;

    public async Task InitializeAsync()
    {
        await _postgres.StartAsync();
        await _redis.StartAsync();

        _factory = new ExamWebFactory(_postgres.GetConnectionString(), _redis.GetConnectionString());
        _client = _factory.CreateClient();
        _client.BaseAddress = new Uri("http://localhost");

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.MigrateAsync();

        var proctorRoleId = await SeedRoleAsync(db, "monitor_proctor", PermissionCatalog.ExamRead, PermissionCatalog.ExamWrite, PermissionCatalog.ExamPublish, PermissionCatalog.PaperRead, PermissionCatalog.PaperWrite, PermissionCatalog.PaperPublish, PermissionCatalog.QuestionRead, PermissionCatalog.QuestionPublish, PermissionCatalog.TagRead, PermissionCatalog.ProctorMonitor);
        await SeedUserAsync(db, ProctorUsername, ProctorPassword, proctorRoleId);

        var studentRoleId = await SeedRoleAsync(db, "monitor_student", PermissionCatalog.AttemptTake, PermissionCatalog.AttemptReadOwn);
        await SeedUserAsync(db, StudentUsername, StudentPassword, studentRoleId);

        _questionId = await SeedQuestionAsync(db, "Q-MON-001");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
        await _redis.DisposeAsync();
    }

    [Fact]
    public async Task 监考快照能取到考生状态()
    {
        await LoginAsync(ProctorUsername, ProctorPassword);
        var sessionId = await CreateSessionAsync();

        await LoginAsync(StudentUsername, StudentPassword);
        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { examSessionId = sessionId });
        start.StatusCode.ShouldBe(HttpStatusCode.OK, await start.Content.ReadAsStringAsync());

        await LoginAsync(ProctorUsername, ProctorPassword);
        var monitoring = await _client.GetAsync($"/api/v1/exam-sessions/{sessionId}/monitoring");
        monitoring.StatusCode.ShouldBe(HttpStatusCode.OK, await monitoring.Content.ReadAsStringAsync());

        var body = await monitoring.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("examSessionId").GetInt64().ShouldBe(sessionId);

        var candidates = body.GetProperty("candidates");
        candidates.GetArrayLength().ShouldBe(1);

        var candidate = candidates[0];
        candidate.GetProperty("status").GetString().ShouldBe("in_progress");
        candidate.GetProperty("totalCount").GetInt32().ShouldBe(1);
        candidate.GetProperty("answeredCount").GetInt32().ShouldBe(0);
        candidate.GetProperty("displayName").GetString().ShouldNotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task 没有监考权限取不到监考快照()
    {
        await LoginAsync(ProctorUsername, ProctorPassword);
        var sessionId = await CreateSessionAsync();

        await LoginAsync(StudentUsername, StudentPassword);
        var monitoring = await _client.GetAsync($"/api/v1/exam-sessions/{sessionId}/monitoring");

        monitoring.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task 监考端能收到实时状态批次()
    {
        await LoginAsync(ProctorUsername, ProctorPassword);
        var sessionId = await CreateSessionAsync();

        await LoginAsync(StudentUsername, StudentPassword);
        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { examSessionId = sessionId });
        start.StatusCode.ShouldBe(HttpStatusCode.OK, await start.Content.ReadAsStringAsync());

        var token = await LoginAndGetTokenAsync(ProctorUsername, ProctorPassword);

        await using var connection = new HubConnectionBuilder()
            .WithUrl(new Uri("http://localhost/hubs/proctoring"), options =>
            {
                options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                options.AccessTokenProvider = () => Task.FromResult<string?>(token);
            })
            .Build();

        var received = new TaskCompletionSource<ExamStatusBatchDto>(TaskCreationOptions.RunContinuationsAsynchronously);
        connection.On<ExamStatusBatchDto>("ExamStatusBatch", batch => received.TrySetResult(batch));

        await connection.StartAsync();
        await connection.InvokeAsync("JoinAsProctor", sessionId);

        // 后台服务每两秒推一批，最多等 15 秒。
        var batch = await received.Task.WaitAsync(TimeSpan.FromSeconds(15));
        batch.ExamSessionId.ShouldBe(sessionId);
        batch.Candidates.Count.ShouldBe(1);
        batch.Candidates[0].Status.ShouldBe("in_progress");
    }

    private async Task<string> LoginAndGetTokenAsync(string username, string password)
    {
        var response = await _client.PostAsJsonAsync("/api/v1/auth/login", new { username, password });
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("accessToken").GetString()!;
    }

    private async Task LoginAsync(string username, string password)
    {
        var response = await _client.PostAsJsonAsync("/api/v1/auth/login", new { username, password });
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        _client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", body.GetProperty("accessToken").GetString());
    }

    private async Task<long> CreateSessionAsync()
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
            });
        session.StatusCode.ShouldBe(HttpStatusCode.OK, await session.Content.ReadAsStringAsync());

        var sessionBody = await session.Content.ReadFromJsonAsync<JsonElement>();
        var sessionId = sessionBody.GetProperty("session").GetProperty("id").GetInt64();

        var publish = await _client.PostAsync($"/api/v1/exam-sessions/{sessionId}/publish", null);
        publish.StatusCode.ShouldBe(HttpStatusCode.OK, await publish.Content.ReadAsStringAsync());

        return sessionId;
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

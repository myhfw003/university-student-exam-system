using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
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

/// <summary>监考处置的端到端测试：警告、强制交卷、处置历史与审计。</summary>
public sealed class ProctorActionEndpointTests : IAsyncLifetime
{
    private const string ProctorUsername = "proctoraction1";
    private const string ProctorPassword = "Passw0rd!";
    private const string StudentUsername = "proctorstudent1";
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

        var proctorRoleId = await SeedRoleAsync(db, "proctor_action_admin", PermissionCatalog.ExamRead, PermissionCatalog.ExamWrite, PermissionCatalog.ExamPublish, PermissionCatalog.PaperRead, PermissionCatalog.PaperWrite, PermissionCatalog.PaperPublish, PermissionCatalog.QuestionRead, PermissionCatalog.QuestionPublish, PermissionCatalog.TagRead, PermissionCatalog.ProctorAct, PermissionCatalog.ProctorMonitor);
        await SeedUserAsync(db, ProctorUsername, ProctorPassword, proctorRoleId);

        var studentRoleId = await SeedRoleAsync(db, "proctor_action_student", PermissionCatalog.AttemptTake, PermissionCatalog.AttemptReadOwn);
        await SeedUserAsync(db, StudentUsername, StudentPassword, studentRoleId);

        _questionId = await SeedQuestionAsync(db, "Q-PRA-001");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
        await _redis.DisposeAsync();
    }

    [Fact]
    public async Task 警告会记录处置并推送给考生()
    {
        var attemptId = await StartAttemptAsync();

        var token = await LoginAndGetTokenAsync(StudentUsername, StudentPassword);
        await using var connection = new HubConnectionBuilder()
            .WithUrl(new Uri("http://localhost/hubs/exam"), options =>
            {
                options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                options.AccessTokenProvider = () => Task.FromResult<string?>(token);
            })
            .Build();

        var received = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        connection.On<string>("ProctorWarning", message => received.TrySetResult(message));

        await connection.StartAsync();
        await connection.InvokeAsync("JoinAttempt", attemptId);

        await LoginAsync(ProctorUsername, ProctorPassword);
        var action = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/proctor-actions",
            new { actionType = "warn", message = "请注意考试纪律", reason = (string?)null });
        action.StatusCode.ShouldBe(HttpStatusCode.OK, await action.Content.ReadAsStringAsync());

        var body = await action.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("actionType").GetString().ShouldBe("warn");
        body.GetProperty("message").GetString().ShouldBe("请注意考试纪律");

        var warning = await received.Task.WaitAsync(TimeSpan.FromSeconds(10));
        warning.ShouldBe("请注意考试纪律");
    }

    [Fact]
    public async Task 强制交卷必须填原因()
    {
        var attemptId = await StartAttemptAsync();

        await LoginAsync(ProctorUsername, ProctorPassword);
        var action = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/proctor-actions",
            new { actionType = "force_submit", message = (string?)null, reason = (string?)null });

        action.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task 已经交卷的作答再强制交卷会被拒绝()
    {
        var attemptId = await StartAttemptAsync();

        // 考生先自己交卷。
        await LoginAsync(StudentUsername, StudentPassword);
        var submit = await _client.PostAsJsonAsync($"/api/v1/attempts/{attemptId}/submit", new { });
        submit.StatusCode.ShouldBe(HttpStatusCode.OK, await submit.Content.ReadAsStringAsync());

        // 监考再点强制交卷：不能再判一次分（会撞「一次作答一题一条成绩」的唯一约束），
        // 也不能 500，要给明确的业务错误。
        await LoginAsync(ProctorUsername, ProctorPassword);
        var action = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/proctor-actions",
            new { actionType = "force_submit", message = "强制交卷", reason = "切屏超限" });

        action.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task 强制交卷后会话被交掉且拒绝保存()
    {
        var attemptId = await StartAttemptAsync();

        await LoginAsync(ProctorUsername, ProctorPassword);
        var action = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/proctor-actions",
            new { actionType = "force_submit", message = "多次切屏", reason = "切屏超限" });
        action.StatusCode.ShouldBe(HttpStatusCode.OK, await action.Content.ReadAsStringAsync());

        var body = await action.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("actionType").GetString().ShouldBe("force_submit");
        body.GetProperty("reason").GetString().ShouldBe("切屏超限");

        // 切回考生身份：强制交卷后该会话拒绝继续保存答案。
        await LoginAsync(StudentUsername, StudentPassword);

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
    public async Task 处置历史可查且写审计()
    {
        var attemptId = await StartAttemptAsync();

        await LoginAsync(ProctorUsername, ProctorPassword);
        await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/proctor-actions",
            new { actionType = "note", message = "考生疑似使用第二设备", reason = (string?)null });

        var list = await _client.GetAsync($"/api/v1/attempts/{attemptId}/proctor-actions");
        list.StatusCode.ShouldBe(HttpStatusCode.OK, await list.Content.ReadAsStringAsync());

        var body = await list.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("total").GetInt32().ShouldBe(1);
        body.GetProperty("items")[0].GetProperty("actionType").GetString().ShouldBe("note");
        body.GetProperty("items")[0].GetProperty("operatorName").GetString().ShouldNotBeNullOrWhiteSpace();

        // 处置写审计。
        var audits = await CountAuditAsync("proctor_action.create");
        audits.ShouldBe(1);
    }

    private async Task<int> CountAuditAsync(string action)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        return await db.Database
            .SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM audit.audit_log WHERE action = {action}")
            .SingleAsync();
    }

    private async Task<long> StartAttemptAsync()
    {
        await LoginAsync(ProctorUsername, ProctorPassword);
        var sessionId = await CreateSessionAsync();

        await LoginAsync(StudentUsername, StudentPassword);

        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { examSessionId = sessionId });
        start.StatusCode.ShouldBe(HttpStatusCode.OK, await start.Content.ReadAsStringAsync());

        var body = await start.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("attemptId").GetInt64();
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

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
/// 阅卷分发与领取：先到先得、指派、上一份 / 下一份。
/// </summary>
public sealed class ReviewDispatchTests : IAsyncLifetime
{
    private const string TeacherA = "dispatcher01";
    private const string TeacherB = "dispatcher02";
    private const string TeacherPassword = "Passw0rd!";
    private const string StudentUsername = "dispatchstudent1";
    private const string StudentPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
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
            "dispatch_teacher",
            PermissionCatalog.ExamRead,
            PermissionCatalog.ExamWrite,
            PermissionCatalog.ExamPublish,
            PermissionCatalog.PaperRead,
            PermissionCatalog.PaperWrite,
            PermissionCatalog.PaperPublish,
            PermissionCatalog.QuestionRead,
            PermissionCatalog.QuestionPublish,
            PermissionCatalog.TagRead,
            PermissionCatalog.ReviewGrade);

        await SeedUserAsync(db, TeacherA, TeacherPassword, teacherRoleId);
        await SeedUserAsync(db, TeacherB, TeacherPassword, teacherRoleId);

        var studentRoleId = await SeedRoleAsync(db, "dispatch_student", PermissionCatalog.AttemptTake, PermissionCatalog.AttemptReadOwn);
        await SeedUserAsync(db, StudentUsername, StudentPassword, studentRoleId);

        _shortQuestionId = await SeedShortQuestionAsync(db, "Q-DSP-001");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 领取任务后状态变为阅卷中且记录阅卷人()
    {
        var taskId = await CreatePendingTaskAsync();

        await LoginAsync(TeacherA, TeacherPassword);
        var claim = await _client.PostAsync($"/api/v1/review-tasks/{taskId}/claim", null);
        claim.StatusCode.ShouldBe(HttpStatusCode.OK, await claim.Content.ReadAsStringAsync());

        var body = await claim.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("status").GetString().ShouldBe("in_review");
        body.GetProperty("statusLabel").GetString().ShouldBe("阅卷中");
        body.GetProperty("reviewerId").GetInt64().ShouldBeGreaterThan(0);
    }

    [Fact]
    public async Task 已被领取的任务他人领取失败()
    {
        var taskId = await CreatePendingTaskAsync();

        await LoginAsync(TeacherA, TeacherPassword);
        var first = await _client.PostAsync($"/api/v1/review-tasks/{taskId}/claim", null);
        first.StatusCode.ShouldBe(HttpStatusCode.OK, await first.Content.ReadAsStringAsync());

        // 换一个人来领：先到先得，第二个人拿不到。
        await LoginAsync(TeacherB, TeacherPassword);
        var second = await _client.PostAsync($"/api/v1/review-tasks/{taskId}/claim", null);
        second.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);

        var problem = await second.Content.ReadFromJsonAsync<JsonElement>();
        problem.GetProperty("detail").GetString()!.ShouldContain("已被领取");
    }

    [Fact]
    public async Task 同一份任务重复领取自己也能再领一次失败()
    {
        var taskId = await CreatePendingTaskAsync();

        await LoginAsync(TeacherA, TeacherPassword);
        var first = await _client.PostAsync($"/api/v1/review-tasks/{taskId}/claim", null);
        first.StatusCode.ShouldBe(HttpStatusCode.OK);

        var second = await _client.PostAsync($"/api/v1/review-tasks/{taskId}/claim", null);
        second.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task 指派给指定阅卷人后只有他能领()
    {
        var taskId = await CreatePendingTaskAsync();

        // 教师 B 的用户 ID：从登录响应里取。
        await LoginAsync(TeacherB, TeacherPassword);
        var teacherBId = await CurrentUserIdAsync();

        await LoginAsync(TeacherA, TeacherPassword);
        var assign = await _client.PostAsJsonAsync(
            $"/api/v1/review-tasks/{taskId}/assign",
            new { userId = teacherBId });
        assign.StatusCode.ShouldBe(HttpStatusCode.OK, await assign.Content.ReadAsStringAsync());

        var assigned = await assign.Content.ReadFromJsonAsync<JsonElement>();
        assigned.GetProperty("assigneeId").GetInt64().ShouldBe(teacherBId);
        assigned.GetProperty("status").GetString().ShouldBe("pending");

        // 指派不是领取：A 领不走。
        var byA = await _client.PostAsync($"/api/v1/review-tasks/{taskId}/claim", null);
        byA.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);

        // 被指派人可以领。
        await LoginAsync(TeacherB, TeacherPassword);
        var byB = await _client.PostAsync($"/api/v1/review-tasks/{taskId}/claim", null);
        byB.StatusCode.ShouldBe(HttpStatusCode.OK, await byB.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task 指派给没有阅卷权限的人被拒绝()
    {
        var taskId = await CreatePendingTaskAsync();

        await LoginAsync(StudentUsername, StudentPassword);
        var studentId = await CurrentUserIdAsync();

        await LoginAsync(TeacherA, TeacherPassword);
        var assign = await _client.PostAsJsonAsync(
            $"/api/v1/review-tasks/{taskId}/assign",
            new { userId = studentId });

        assign.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
        var problem = await assign.Content.ReadFromJsonAsync<JsonElement>();
        problem.GetProperty("detail").GetString()!.ShouldContain("阅卷权限");
    }

    [Fact]
    public async Task 卷宗详情带参考答案与要点命中()
    {
        var taskId = await CreatePendingTaskAsync();

        await LoginAsync(TeacherA, TeacherPassword);
        var detail = await _client.GetAsync($"/api/v1/review-tasks/{taskId}");
        detail.StatusCode.ShouldBe(HttpStatusCode.OK, await detail.Content.ReadAsStringAsync());

        var body = await detail.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("task").GetProperty("answerText").GetString()!.ShouldContain("三次握手");
        body.GetProperty("stem").GetString().ShouldBe("题干");

        // 要点命中：答到了「三次握手」就命中一个，另一个要点漏掉。
        var keypoints = body.GetProperty("keypoints").EnumerateArray().ToList();
        keypoints.Count.ShouldBe(2);
        keypoints.ShouldContain(k => k.GetProperty("hit").GetBoolean());
        keypoints.ShouldContain(k => !k.GetProperty("hit").GetBoolean());
    }

    [Fact]
    public async Task 上一份与下一份按队列顺序给出()
    {
        var first = await CreatePendingTaskAsync();
        var second = await CreatePendingTaskAsync();

        await LoginAsync(TeacherA, TeacherPassword);

        var neighbors = await _client.GetAsync($"/api/v1/review-tasks/{second}/neighbors");
        neighbors.StatusCode.ShouldBe(HttpStatusCode.OK, await neighbors.Content.ReadAsStringAsync());

        var body = await neighbors.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("previousId").GetInt64().ShouldBe(first);
        body.GetProperty("nextId").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task 队列可按题目与指派人过滤()
    {
        var taskId = await CreatePendingTaskAsync();

        await LoginAsync(TeacherA, TeacherPassword);

        // 按题目过滤：命中。
        var byQuestion = await _client.GetAsync($"/api/v1/review-tasks?questionId={_shortQuestionId}");
        byQuestion.StatusCode.ShouldBe(HttpStatusCode.OK);
        var byQuestionBody = await byQuestion.Content.ReadFromJsonAsync<JsonElement>();
        byQuestionBody.GetProperty("total").GetInt32().ShouldBe(1);

        // 按不存在的题目过滤：不命中。
        var byOther = await _client.GetAsync("/api/v1/review-tasks?questionId=999999");
        var byOtherBody = await byOther.Content.ReadFromJsonAsync<JsonElement>();
        byOtherBody.GetProperty("total").GetInt32().ShouldBe(0);

        // 指派之后按指派人过滤才看得到。
        await LoginAsync(TeacherB, TeacherPassword);
        var teacherBId = await CurrentUserIdAsync();

        await LoginAsync(TeacherA, TeacherPassword);
        await _client.PostAsJsonAsync(
            $"/api/v1/review-tasks/{taskId}/assign",
            new { userId = teacherBId });

        var byAssignee = await _client.GetAsync($"/api/v1/review-tasks?assigneeId={teacherBId}");
        var byAssigneeBody = await byAssignee.Content.ReadFromJsonAsync<JsonElement>();
        byAssigneeBody.GetProperty("total").GetInt32().ShouldBe(1);

        // mine 是「指派给我的」的简写。
        await LoginAsync(TeacherB, TeacherPassword);
        var mine = await _client.GetAsync("/api/v1/review-tasks?mine=true");
        var mineBody = await mine.Content.ReadFromJsonAsync<JsonElement>();
        mineBody.GetProperty("total").GetInt32().ShouldBe(1);
    }

    [Fact]
    public async Task 没有阅卷权限看不到任务详情()
    {
        var taskId = await CreatePendingTaskAsync();

        await LoginAsync(StudentUsername, StudentPassword);
        var detail = await _client.GetAsync($"/api/v1/review-tasks/{taskId}");

        detail.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    /// <summary>造一份待阅任务：学生作答交卷后生成。</summary>
    private async Task<long> CreatePendingTaskAsync()
    {
        var attemptId = await StartAttemptAsync();

        var save = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/answers",
            new { clientSeq = 1, items = new[] { new { questionId = _shortQuestionId, payload = new { text = "TCP 三次握手可以建立连接" } } } });
        save.StatusCode.ShouldBe(HttpStatusCode.OK, await save.Content.ReadAsStringAsync());

        var submit = await _client.PostAsJsonAsync($"/api/v1/attempts/{attemptId}/submit", new { reason = "manual" });
        submit.StatusCode.ShouldBe(HttpStatusCode.OK, await submit.Content.ReadAsStringAsync());

        await LoginAsync(TeacherA, TeacherPassword);
        var list = await _client.GetAsync("/api/v1/review-tasks");
        list.StatusCode.ShouldBe(HttpStatusCode.OK);

        var body = await list.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray().ToList();

        // 取最新的那条（队列按创建时间升序）。
        return items[^1].GetProperty("id").GetInt64();
    }

    private async Task<long> CurrentUserIdAsync()
    {
        var me = await _client.GetAsync("/api/v1/auth/me");
        me.StatusCode.ShouldBe(HttpStatusCode.OK, await me.Content.ReadAsStringAsync());

        var body = await me.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("id").GetInt64();
    }

    private async Task<long> StartAttemptAsync()
    {
        await LoginAsync(TeacherA, TeacherPassword);
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
                name = "分发测试考试",
                targetTotalScore = 10,
                durationMinutes = 15,
            });
        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var paperBody = await create.Content.ReadFromJsonAsync<JsonElement>();
        var paperId = paperBody.GetProperty("paper").GetProperty("id").GetInt64();

        var add = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/items",
            new { questionId = _shortQuestionId, score = 10m });
        add.StatusCode.ShouldBe(HttpStatusCode.OK, await add.Content.ReadAsStringAsync());

        var publishPaper = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/publish",
            new { warningOverrideReason = "本次含主观题，用于验证阅卷分发" });
        publishPaper.StatusCode.ShouldBe(HttpStatusCode.OK, await publishPaper.Content.ReadAsStringAsync());

        var session = await _client.PostAsJsonAsync(
            "/api/v1/exam-sessions",
            new
            {
                paperId,
                name = "分发测试考试",
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

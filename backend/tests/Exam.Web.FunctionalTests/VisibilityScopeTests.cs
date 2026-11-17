using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
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
/// 答案可见性与对象级范围。
/// <para>
/// 规则一：考试进行中任何人都读不到答案与解析，场次关闭之后才按策略公布；
/// 练习按「解析反馈时机」公布：即时反馈边做边看，提交后统一给。
/// </para>
/// <para>
/// 规则二：权限码之外还有对象级范围——考生只看得到自己参加的场次，
/// 教职人员只看得到自己负责的场次，出题的人看得到自己卷子的快照。
/// </para>
/// </summary>
public sealed class VisibilityScopeTests : IAsyncLifetime
{
    private const string TeacherUsername = "scope_teacher1";
    private const string TeacherPassword = "Passw0rd!";
    private const string StudentUsername = "scope_student1";
    private const string StudentPassword = "Passw0rd!";
    private const string OtherStudentUsername = "scope_student2";
    private const string OtherStudentPassword = "Passw0rd!";
    private const string ResetUsername = "scope_resetuser1";
    private const string ResetPassword = "Passw0rd!";
    private const string ReaderUsername = "scope_reader1";
    private const string ReaderPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _questionId;
    private long _otherStudentId;

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
            "scope_teacher",
            PermissionCatalog.ExamRead,
            PermissionCatalog.ExamWrite,
            PermissionCatalog.ExamPublish,
            PermissionCatalog.PaperRead,
            PermissionCatalog.PaperWrite,
            PermissionCatalog.PaperPublish,
            PermissionCatalog.QuestionRead,
            PermissionCatalog.QuestionPublish,
            PermissionCatalog.TagRead,
            PermissionCatalog.PracticeRead,
            PermissionCatalog.PracticeWrite,
            PermissionCatalog.ReviewGrade,
            PermissionCatalog.GradePublish,
            PermissionCatalog.AnalyticsRead);

        await SeedUserAsync(db, TeacherUsername, TeacherPassword, teacherRoleId);

        // 考生：只看得到自己参加的场次，没有出题与阅卷权限，也不进题库。
        var studentRoleId = await SeedRoleAsync(
            db,
            "scope_student",
            PermissionCatalog.ExamRead,
            PermissionCatalog.TagRead,
            PermissionCatalog.PaperRead,
            PermissionCatalog.AttemptTake,
            PermissionCatalog.AttemptReadOwn);

        await SeedUserAsync(db, StudentUsername, StudentPassword, studentRoleId);
        _otherStudentId = await SeedUserAsync(db, OtherStudentUsername, OtherStudentPassword, studentRoleId);
        await SeedUserAsync(db, ResetUsername, ResetPassword, studentRoleId, mustChangePassword: true);

        // 只读题库的人（社会人士那一档）：能读题干，但读不到答案与解析。
        var readerRoleId = await SeedRoleAsync(db, "scope_reader", PermissionCatalog.QuestionRead);
        await SeedUserAsync(db, ReaderUsername, ReaderPassword, readerRoleId);

        _questionId = await SeedSingleQuestionAsync(db, "Q-SCP-001");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 练习即时反馈_交卷前就能看到答案与解析()
    {
        var assignmentId = await CreatePracticeAsync("immediate");

        await LoginAsync(StudentUsername, StudentPassword);
        var attemptId = await StartPracticeAttemptAsync(assignmentId);

        await SaveAnswerAsync(attemptId, _questionId, new { selectedOptionKeys = new[] { "A" } });

        var feedback = await _client.PostAsJsonAsync($"/api/v1/attempts/{attemptId}/feedback", new { });
        feedback.StatusCode.ShouldBe(HttpStatusCode.OK, await feedback.Content.ReadAsStringAsync());

        var body = await feedback.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("feedbackTiming").GetString().ShouldBe("immediate");

        var item = body.GetProperty("questions")[0];
        item.GetProperty("correctKeys").EnumerateArray().Select(k => k.GetString()).ShouldBe(["A"]);
        item.GetProperty("analysis").GetString()!.ShouldBe("解析：选 A。");
        item.GetProperty("referenceAnswer").GetString()!.ShouldBe("参考答案：A。");
    }

    [Fact]
    public async Task 练习提交后反馈_交卷前没有解析()
    {
        var assignmentId = await CreatePracticeAsync("after_submit");

        await LoginAsync(StudentUsername, StudentPassword);
        var attemptId = await StartPracticeAttemptAsync(assignmentId);

        await SaveAnswerAsync(attemptId, _questionId, new { selectedOptionKeys = new[] { "A" } });

        // 提交后统一给：交卷之前没有反馈。
        var early = await _client.PostAsJsonAsync($"/api/v1/attempts/{attemptId}/feedback", new { });
        early.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);

        var submit = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/submit", new { reason = "manual" });
        submit.StatusCode.ShouldBe(HttpStatusCode.OK, await submit.Content.ReadAsStringAsync());

        var feedback = await _client.PostAsJsonAsync($"/api/v1/attempts/{attemptId}/feedback", new { });
        feedback.StatusCode.ShouldBe(HttpStatusCode.OK, await feedback.Content.ReadAsStringAsync());

        var body = await feedback.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("questions")[0].GetProperty("correctKeys")
            .EnumerateArray().Select(k => k.GetString()).ShouldBe(["A"]);
    }

    [Fact]
    public async Task 考生进不了题库()
    {
        await LoginAsync(StudentUsername, StudentPassword);

        var response = await _client.GetAsync($"/api/v1/questions/{_questionId}");
        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden, await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task 读题库的人看不到答案与解析()
    {
        await LoginAsync(ReaderUsername, ReaderPassword);

        var response = await _client.GetAsync($"/api/v1/questions/{_questionId}");
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("analysis").ValueKind.ShouldBe(JsonValueKind.Null);
        body.GetProperty("referenceAnswer").ValueKind.ShouldBe(JsonValueKind.Null);
        body.GetProperty("keypoints").GetArrayLength().ShouldBe(0);
        body.GetProperty("steps").GetArrayLength().ShouldBe(0);

        foreach (var option in body.GetProperty("options").EnumerateArray())
        {
            option.GetProperty("isCorrect").GetBoolean().ShouldBeFalse();
        }
    }

    [Fact]
    public async Task 考生读不到试卷快照()
    {
        var paperId = await CreateExamPaperAsync();

        await LoginAsync(StudentUsername, StudentPassword);

        var list = await _client.GetAsync($"/api/v1/papers/{paperId}/snapshots");
        list.StatusCode.ShouldBe(HttpStatusCode.Forbidden, await list.Content.ReadAsStringAsync());

        var detail = await _client.GetAsync($"/api/v1/papers/{paperId}/snapshots/latest");
        detail.StatusCode.ShouldBe(HttpStatusCode.Forbidden, await detail.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task 考生看得到自己参加的场次_看不到别人的场次()
    {
        var paperId = await CreateExamPaperAsync();

        // 全员开放：所有考生都看得见。
        var openSessionId = await CreateSessionAsync(paperId, "open", []);

        // 指定考生：只有被指定的人看得见。
        var directSessionId = await CreateSessionAsync(paperId, "direct", [_otherStudentId]);

        await LoginAsync(StudentUsername, StudentPassword);

        var list = await _client.GetAsync("/api/v1/exam-sessions?page=1&size=50");
        list.StatusCode.ShouldBe(HttpStatusCode.OK, await list.Content.ReadAsStringAsync());

        var listBody = await list.Content.ReadFromJsonAsync<JsonElement>();
        var visible = listBody.GetProperty("items").EnumerateArray()
            .Select(i => i.GetProperty("id").GetInt64())
            .ToList();

        visible.ShouldContain(openSessionId);
        visible.ShouldNotContain(directSessionId);

        // 详情同样按范围给。
        var open = await _client.GetAsync($"/api/v1/exam-sessions/{openSessionId}");
        open.StatusCode.ShouldBe(HttpStatusCode.OK, await open.Content.ReadAsStringAsync());

        var other = await _client.GetAsync($"/api/v1/exam-sessions/{directSessionId}");
        other.StatusCode.ShouldBe(HttpStatusCode.Forbidden, await other.Content.ReadAsStringAsync());

        // 被指定的考生看得到自己的场次。
        await LoginAsync(OtherStudentUsername, OtherStudentPassword);
        var mine = await _client.GetAsync($"/api/v1/exam-sessions/{directSessionId}");
        mine.StatusCode.ShouldBe(HttpStatusCode.OK, await mine.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task 强制改密期间只能用改密接口()
    {
        await LoginAsync(ResetUsername, ResetPassword);

        // 档案里带着「必须改密」标记。
        var me = await _client.GetAsync("/api/v1/auth/me");
        me.StatusCode.ShouldBe(HttpStatusCode.OK, await me.Content.ReadAsStringAsync());
        var meBody = await me.Content.ReadFromJsonAsync<JsonElement>();
        meBody.GetProperty("mustChangePassword").GetBoolean().ShouldBeTrue();

        // 其它接口一律挡住。
        var tags = await _client.GetAsync("/api/v1/tags");
        tags.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
        (await tags.Content.ReadAsStringAsync()).ShouldContain("初始密码");

        // 改密之后恢复通行。
        var change = await _client.PostAsJsonAsync(
            "/api/v1/auth/change-password",
            new { currentPassword = ResetPassword, newPassword = "NewPassw0rd!" });
        change.StatusCode.ShouldBe(HttpStatusCode.OK, await change.Content.ReadAsStringAsync());

        var body = await change.Content.ReadFromJsonAsync<JsonElement>();
        var token = body.GetProperty("accessToken").GetString()!;
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var after = await _client.GetAsync("/api/v1/tags");
        after.StatusCode.ShouldBe(HttpStatusCode.OK, await after.Content.ReadAsStringAsync());

        var meAfter = await _client.GetAsync("/api/v1/auth/me");
        var meAfterBody = await meAfter.Content.ReadFromJsonAsync<JsonElement>();
        meAfterBody.GetProperty("mustChangePassword").GetBoolean().ShouldBeFalse();
    }

    // ---------- 造数据 ----------

    private async Task<long> CreateExamPaperAsync()
    {
        await LoginAsync(TeacherUsername, TeacherPassword);

        var create = await _client.PostAsJsonAsync(
            "/api/v1/papers",
            new
            {
                kind = "exam",
                name = "范围测试考试卷",
                targetTotalScore = 10,
                durationMinutes = 15,
                answerPolicy = "after_close",
            });
        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var paperId = (await create.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("paper").GetProperty("id").GetInt64();

        var add = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/items",
            new { questionId = _questionId, score = 10m });
        add.StatusCode.ShouldBe(HttpStatusCode.OK, await add.Content.ReadAsStringAsync());

        var publish = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/publish",
            new { warningOverrideReason = "用于验证可见性与范围" });
        publish.StatusCode.ShouldBe(HttpStatusCode.OK, await publish.Content.ReadAsStringAsync());

        return paperId;
    }

    private async Task<long> CreateSessionAsync(long paperId, string participantMode, long[] participantUserIds)
    {
        await LoginAsync(TeacherUsername, TeacherPassword);

        var session = await _client.PostAsJsonAsync(
            "/api/v1/exam-sessions",
            new
            {
                paperId,
                name = $"范围测试场次-{participantMode}",
                openAt = DateTimeOffset.UtcNow.AddMinutes(-5),
                closeAt = DateTimeOffset.UtcNow.AddHours(4),
                durationMinutes = 90,
                participantMode,
                participantUserIds,
            });
        session.StatusCode.ShouldBe(HttpStatusCode.OK, await session.Content.ReadAsStringAsync());

        var sessionId = (await session.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("session").GetProperty("id").GetInt64();

        var publish = await _client.PostAsync($"/api/v1/exam-sessions/{sessionId}/publish", null);
        publish.StatusCode.ShouldBe(HttpStatusCode.OK, await publish.Content.ReadAsStringAsync());

        return sessionId;
    }

    private async Task<long> CreatePracticeAsync(string feedbackTiming)
    {
        await LoginAsync(TeacherUsername, TeacherPassword);

        var create = await _client.PostAsJsonAsync(
            "/api/v1/papers",
            new
            {
                kind = "practice",
                name = "可见性测试练习卷",
                targetTotalScore = 10,
                durationMinutes = 30,
                practiceRules = new
                {
                    maxAttempts = 0,
                    feedbackTiming,
                    reflowMistakes = false,
                    suggestedMinutes = 30,
                },
            });
        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var paperId = (await create.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("paper").GetProperty("id").GetInt64();

        var add = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/items",
            new { questionId = _questionId, score = 10m });
        add.StatusCode.ShouldBe(HttpStatusCode.OK, await add.Content.ReadAsStringAsync());

        var publish = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/publish",
            new { warningOverrideReason = "用于验证练习反馈时机" });
        publish.StatusCode.ShouldBe(HttpStatusCode.OK, await publish.Content.ReadAsStringAsync());

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var now = DateTimeOffset.UtcNow;

        var assignment = PracticeAssignment.Create(paperId, "可见性测试练习", [], now, null, now);
        assignment.Publish(now);

        await db.PracticeAssignments.AddAsync(assignment);
        await db.SaveChangesAsync();

        return assignment.Id;
    }

    private async Task<long> StartPracticeAttemptAsync(long assignmentId)
    {
        var start = await _client.PostAsJsonAsync(
            "/api/v1/attempts", new { practiceAssignmentId = assignmentId });
        start.StatusCode.ShouldBe(HttpStatusCode.OK, await start.Content.ReadAsStringAsync());

        return (await start.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("attemptId").GetInt64();
    }

    private async Task SaveAnswerAsync(long attemptId, long questionId, object payload)
    {
        var save = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/answers",
            new { clientSeq = 1, items = new[] { new { questionId, payload } } });

        save.StatusCode.ShouldBe(HttpStatusCode.OK, await save.Content.ReadAsStringAsync());
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

    private static async Task<long> SeedUserAsync(
        AppDbContext db,
        string username,
        string password,
        long roleId,
        bool mustChangePassword = false)
    {
        var verifier = new Pbkdf2PasswordVerifier();
        var now = DateTimeOffset.UtcNow;

        var user = User.Register(username, username, verifier.Hash(password), now);
        if (mustChangePassword)
        {
            user.MarkMustChangePassword(now, null);
        }

        await db.Users.AddAsync(user);
        await db.SaveChangesAsync();

        await db.UserRoles.AddAsync(UserRole.Create(user.Id, roleId, null, now));
        await db.SaveChangesAsync();

        return user.Id;
    }
}

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
/// 错题本：查询、过滤、标记已掌握。
/// </summary>
public sealed class MistakeBookTests : IAsyncLifetime
{
    private const string TeacherUsername = "bookteacher1";
    private const string TeacherPassword = "Passw0rd!";
    private const string StudentUsername = "bookstudent1";
    private const string OtherStudentUsername = "bookstudent2";
    private const string StudentPassword = "Passw0rd!";
    private const string AdminUsername = "bookadmin1";
    private const string AdminPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _singleQuestionId;
    private long _shortQuestionId;
    private long _parentTagId;
    private long _childTagId;
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
            "book_teacher",
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
            PermissionCatalog.GradePublish);

        await SeedUserAsync(db, TeacherUsername, TeacherPassword, teacherRoleId);

        var studentRoleId = await SeedRoleAsync(db, "book_student", PermissionCatalog.AttemptTake, PermissionCatalog.AttemptReadOwn);
        await SeedUserAsync(db, StudentUsername, StudentPassword, studentRoleId);
        await SeedUserAsync(db, OtherStudentUsername, StudentPassword, studentRoleId);

        var adminRoleId = await SeedRoleAsync(db, "book_admin", PermissionCatalog.SystemConfigure);
        await SeedUserAsync(db, AdminUsername, AdminPassword, adminRoleId);

        _parentTagId = await SeedTagAsync(db, "book_parent", "父标签", parentId: null);
        _childTagId = await SeedTagAsync(db, "book_child", "子标签", parentId: _parentTagId);

        _singleQuestionId = await SeedSingleQuestionAsync(db, "Q-BOK-001", _childTagId);
        _shortQuestionId = await SeedShortQuestionAsync(db, "Q-BOK-002");

        _sessionId = await CreateSessionAsync();
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 错题本列出做错的题()
    {
        await MakeMistakeAsync();

        await LoginAsync(StudentUsername, StudentPassword);
        var list = await _client.GetAsync("/api/v1/mistakes");
        list.StatusCode.ShouldBe(HttpStatusCode.OK, await list.Content.ReadAsStringAsync());

        var body = await list.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("total").GetInt32().ShouldBe(1);

        var item = body.GetProperty("items")[0];
        item.GetProperty("questionId").GetInt64().ShouldBe(_singleQuestionId);
        item.GetProperty("questionCode").GetString().ShouldBe("Q-BOK-001");
        item.GetProperty("questionType").GetString().ShouldBe("single");
        item.GetProperty("questionTypeLabel").GetString().ShouldBe("单选题");
        item.GetProperty("stem").GetString().ShouldBe("单选题题干");
        item.GetProperty("reason").GetString().ShouldBe("single_wrong");
        item.GetProperty("reasonLabel").GetString().ShouldBe("单选错选");
        item.GetProperty("sourceType").GetString().ShouldBe("exam");
        item.GetProperty("wrongCount").GetInt32().ShouldBe(1);
        item.GetProperty("tagNames").EnumerateArray().Select(t => t.GetString()).ShouldBe(["子标签"]);
    }

    [Fact]
    public async Task 错题本可按题型过滤()
    {
        await MakeMistakeAsync();

        await LoginAsync(StudentUsername, StudentPassword);

        var byType = await _client.GetAsync("/api/v1/mistakes?questionType=single");
        var byTypeBody = await byType.Content.ReadFromJsonAsync<JsonElement>();
        byTypeBody.GetProperty("total").GetInt32().ShouldBe(1);

        var byOtherType = await _client.GetAsync("/api/v1/mistakes?questionType=short");
        var byOtherTypeBody = await byOtherType.Content.ReadFromJsonAsync<JsonElement>();
        byOtherTypeBody.GetProperty("total").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task 错题本可按标签过滤且含标签子树()
    {
        await MakeMistakeAsync();

        await LoginAsync(StudentUsername, StudentPassword);

        // 题挂在子标签上，按子标签过滤能命中。
        var byChild = await _client.GetAsync($"/api/v1/mistakes?tagId={_childTagId}");
        var byChildBody = await byChild.Content.ReadFromJsonAsync<JsonElement>();
        byChildBody.GetProperty("total").GetInt32().ShouldBe(1);

        // 按父标签过滤也要命中——父标签是子标签的集合。
        var byParent = await _client.GetAsync($"/api/v1/mistakes?tagId={_parentTagId}");
        var byParentBody = await byParent.Content.ReadFromJsonAsync<JsonElement>();
        byParentBody.GetProperty("total").GetInt32().ShouldBe(1);

        // 没挂标签的标签过滤不到。
        var byOther = await _client.GetAsync("/api/v1/mistakes?tagId=999999");
        var byOtherBody = await byOther.Content.ReadFromJsonAsync<JsonElement>();
        byOtherBody.GetProperty("total").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task 错题本可按时间范围过滤()
    {
        await MakeMistakeAsync();

        await LoginAsync(StudentUsername, StudentPassword);

        // 昨天到现在：命中。
        var recent = await _client.GetAsync(
            "/api/v1/mistakes?from="
            + Uri.EscapeDataString(DateTimeOffset.UtcNow.AddDays(-1).ToString("O"))
            + "&to="
            + Uri.EscapeDataString(DateTimeOffset.UtcNow.AddDays(1).ToString("O")));
        recent.StatusCode.ShouldBe(HttpStatusCode.OK, await recent.Content.ReadAsStringAsync());
        var recentBody = await recent.Content.ReadFromJsonAsync<JsonElement>();
        recentBody.GetProperty("total").GetInt32().ShouldBe(1);

        // 上周之前：不命中。
        var old = await _client.GetAsync(
            "/api/v1/mistakes?from="
            + Uri.EscapeDataString(DateTimeOffset.UtcNow.AddDays(-30).ToString("O"))
            + "&to="
            + Uri.EscapeDataString(DateTimeOffset.UtcNow.AddDays(-7).ToString("O")));
        old.StatusCode.ShouldBe(HttpStatusCode.OK, await old.Content.ReadAsStringAsync());
        var oldBody = await old.Content.ReadFromJsonAsync<JsonElement>();
        oldBody.GetProperty("total").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task 标记已掌握后不再出现在错题本()
    {
        await MakeMistakeAsync();

        await LoginAsync(StudentUsername, StudentPassword);

        var resolve = await _client.PostAsync($"/api/v1/mistakes/{_singleQuestionId}/resolve", null);
        resolve.StatusCode.ShouldBe(HttpStatusCode.OK, await resolve.Content.ReadAsStringAsync());

        var body = await resolve.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("resolvedAt").ValueKind.ShouldNotBe(JsonValueKind.Null);

        var list = await _client.GetAsync("/api/v1/mistakes");
        var listBody = await list.Content.ReadFromJsonAsync<JsonElement>();
        listBody.GetProperty("total").GetInt32().ShouldBe(0);

        // 默认口径是「移出错题本」：连「含已掌握」也看不到它。
        var withResolved = await _client.GetAsync("/api/v1/mistakes?includeResolved=true");
        var withResolvedBody = await withResolved.Content.ReadFromJsonAsync<JsonElement>();
        withResolvedBody.GetProperty("total").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task 改成保留口径后已掌握的题留在错题本里()
    {
        await MakeMistakeAsync();

        // 管理员把系统级设置改成「保留但标记已掌握」。
        await LoginAsync(AdminUsername, AdminPassword);
        var update = await _client.PutAsJsonAsync(
            "/api/v1/settings",
            new { mistakeResolutionPolicy = "keep_mastered" });
        update.StatusCode.ShouldBe(HttpStatusCode.OK, await update.Content.ReadAsStringAsync());

        await LoginAsync(StudentUsername, StudentPassword);

        var resolve = await _client.PostAsync($"/api/v1/mistakes/{_singleQuestionId}/resolve", null);
        resolve.StatusCode.ShouldBe(HttpStatusCode.OK, await resolve.Content.ReadAsStringAsync());

        var list = await _client.GetAsync("/api/v1/mistakes");
        var listBody = await list.Content.ReadFromJsonAsync<JsonElement>();
        listBody.GetProperty("total").GetInt32().ShouldBe(0);

        // 保留口径：它留在错题本里，「含已掌握」能看到。
        var withResolved = await _client.GetAsync("/api/v1/mistakes?includeResolved=true");
        var withResolvedBody = await withResolved.Content.ReadFromJsonAsync<JsonElement>();
        withResolvedBody.GetProperty("total").GetInt32().ShouldBe(1);

        var item = withResolvedBody.GetProperty("items")[0];
        item.GetProperty("resolvedAt").ValueKind.ShouldNotBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task 别人的错题看不到()
    {
        await MakeMistakeAsync();

        await LoginAsync(OtherStudentUsername, StudentPassword);
        var list = await _client.GetAsync("/api/v1/mistakes");

        list.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = await list.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("total").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task 标记不存在的错题返回未找到()
    {
        await LoginAsync(StudentUsername, StudentPassword);
        var resolve = await _client.PostAsync("/api/v1/mistakes/999999/resolve", null);

        resolve.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    /// <summary>做错一道题，让它进错题本。</summary>
    private async Task MakeMistakeAsync()
    {
        await LoginAsync(StudentUsername, StudentPassword);

        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { examSessionId = _sessionId });
        start.StatusCode.ShouldBe(HttpStatusCode.OK, await start.Content.ReadAsStringAsync());

        var startBody = await start.Content.ReadFromJsonAsync<JsonElement>();
        var attemptId = startBody.GetProperty("attemptId").GetInt64();

        // 客观题答错；主观题不答（也是错题，但这里只关心客观题）。
        var save = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/answers",
            new { clientSeq = 1, items = new[] { new { questionId = _singleQuestionId, payload = new { selectedOptionKeys = new[] { "B" } } } } });
        save.StatusCode.ShouldBe(HttpStatusCode.OK, await save.Content.ReadAsStringAsync());

        var submit = await _client.PostAsJsonAsync($"/api/v1/attempts/{attemptId}/submit", new { reason = "manual" });
        submit.StatusCode.ShouldBe(HttpStatusCode.OK, await submit.Content.ReadAsStringAsync());

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
                name = "错题本测试考试",
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
            new { warningOverrideReason = "本次含主观题，用于验证错题本" });
        publishPaper.StatusCode.ShouldBe(HttpStatusCode.OK, await publishPaper.Content.ReadAsStringAsync());

        var session = await _client.PostAsJsonAsync(
            "/api/v1/exam-sessions",
            new
            {
                paperId,
                name = "错题本测试考试",
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

    private static async Task<long> SeedTagAsync(AppDbContext db, string code, string name, long? parentId)
    {
        var now = DateTimeOffset.UtcNow;
        var tag = Tag.Create(code, name, TagGroup.KnowledgePoint, null, null, 0, now);
        await db.Tags.AddAsync(tag);
        await db.SaveChangesAsync();

        if (parentId is { } pid)
        {
            var parent = await db.Tags.FirstAsync(t => t.Id == pid);
            tag.SetParent(parent, now);
            await db.SaveChangesAsync();
        }

        return tag.Id;
    }

    private static async Task<long> SeedSingleQuestionAsync(AppDbContext db, string code, long tagId)
    {
        var now = DateTimeOffset.UtcNow;
        var question = Question.CreateDraft(code, QuestionType.Single, "单选题题干", Score.Question(10), 1, now);
        question.AddOption(QuestionOption.Create("A", "甲", true, 0), now);
        question.AddOption(QuestionOption.Create("B", "乙", false, 1), now);
        question.AttachTag(tagId, now);

        await db.Questions.AddAsync(question);
        await db.SaveChangesAsync();

        question.Publish(now);
        await db.SaveChangesAsync();

        return question.Id;
    }

    private static async Task<long> SeedShortQuestionAsync(AppDbContext db, string code)
    {
        var now = DateTimeOffset.UtcNow;
        var question = Question.CreateDraft(code, QuestionType.Short, "简答题题干", Score.Question(10), 1, now);
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

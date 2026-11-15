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
/// 管理端练习管理。
/// <para>
/// 练习的完整生命周期：建单 → 上架 → 学生可见 → 下架 → 学生不可见。
/// 原型缺陷 D9：`archived` 状态原先只有读没有写，这里补上实际的下架路径。
/// </para>
/// </summary>
public sealed class PracticeAdminTests : IAsyncLifetime
{
    private const string TeacherUsername = "pradminteacher1";
    private const string TeacherPassword = "Passw0rd!";
    private const string StudentUsername = "pradminstudent1";
    private const string StudentPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _paperId;
    private long _classTagId;
    private long _knowledgeTagId;

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
            "practice_admin_teacher",
            PermissionCatalog.PaperRead,
            PermissionCatalog.PaperWrite,
            PermissionCatalog.PaperPublish,
            PermissionCatalog.QuestionRead,
            PermissionCatalog.QuestionPublish,
            PermissionCatalog.TagRead,
            PermissionCatalog.PracticeRead,
            PermissionCatalog.PracticeWrite);

        await SeedUserAsync(db, TeacherUsername, TeacherPassword, teacherRoleId);

        var studentRoleId = await SeedRoleAsync(db, "practice_admin_student", PermissionCatalog.AttemptTake, PermissionCatalog.AttemptReadOwn);
        var studentId = await SeedUserAsync(db, StudentUsername, StudentPassword, studentRoleId);

        _classTagId = await SeedTagAsync(db, "pradmin.class", "计科 2301 班", TagGroup.Organization);
        _knowledgeTagId = await SeedTagAsync(db, "pradmin.knowledge", "计算机网络", TagGroup.KnowledgePoint);

        // 学生在这个班：限定这个班的练习对他可见。
        await db.UserTags.AddAsync(UserTag.Create(studentId, _classTagId, DateTimeOffset.UtcNow));
        await db.SaveChangesAsync();

        _paperId = await CreatePracticePaperAsync();
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 练习的完整生命周期()
    {
        await LoginAsync(TeacherUsername, TeacherPassword);

        // 建单：默认是草稿。
        var create = await _client.PostAsJsonAsync(
            "/api/v1/practice-assignments",
            new
            {
                paperId = _paperId,
                title = "管理端练习",
                scopeTagIds = new[] { _classTagId },
                openAt = DateTimeOffset.UtcNow.AddMinutes(-5),
                closeAt = DateTimeOffset.UtcNow.AddDays(7),
            });
        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var created = await create.Content.ReadFromJsonAsync<JsonElement>();
        created.GetProperty("status").GetString().ShouldBe("draft");
        created.GetProperty("statusLabel").GetString().ShouldBe("草稿");
        created.GetProperty("scopeTagNames").EnumerateArray().Select(t => t.GetString()).ShouldContain("计科 2301 班");
        created.GetProperty("attemptCount").GetInt32().ShouldBe(0);

        var assignmentId = created.GetProperty("id").GetInt64();

        // 草稿：学生看不到。
        await LoginAsync(StudentUsername, StudentPassword);
        (await VisiblePracticeIdsAsync()).ShouldNotContain(assignmentId);

        // 上架。
        await LoginAsync(TeacherUsername, TeacherPassword);
        var publish = await _client.PostAsync($"/api/v1/practice-assignments/{assignmentId}/publish", null);
        publish.StatusCode.ShouldBe(HttpStatusCode.OK, await publish.Content.ReadAsStringAsync());

        var published = await publish.Content.ReadFromJsonAsync<JsonElement>();
        published.GetProperty("status").GetString().ShouldBe("published");

        // 上架：学生看得见了。
        await LoginAsync(StudentUsername, StudentPassword);
        (await VisiblePracticeIdsAsync()).ShouldContain(assignmentId);

        // 下架（原型缺陷 D9：archived 状态原先没有写入路径）。
        await LoginAsync(TeacherUsername, TeacherPassword);
        var archive = await _client.PostAsync($"/api/v1/practice-assignments/{assignmentId}/archive", null);
        archive.StatusCode.ShouldBe(HttpStatusCode.OK, await archive.Content.ReadAsStringAsync());

        var archived = await archive.Content.ReadFromJsonAsync<JsonElement>();
        archived.GetProperty("status").GetString().ShouldBe("archived");
        archived.GetProperty("statusLabel").GetString().ShouldBe("已下架");

        // 下架：学生又看不到了。
        await LoginAsync(StudentUsername, StudentPassword);
        (await VisiblePracticeIdsAsync()).ShouldNotContain(assignmentId);
    }

    [Fact]
    public async Task 管理端列表能按状态与关键词过滤()
    {
        await LoginAsync(TeacherUsername, TeacherPassword);

        await CreateAssignmentAsync("期末冲刺练习");
        await CreateAssignmentAsync("章节小练");

        var all = await _client.GetAsync("/api/v1/practice-assignments");
        all.StatusCode.ShouldBe(HttpStatusCode.OK, await all.Content.ReadAsStringAsync());

        var allBody = await all.Content.ReadFromJsonAsync<JsonElement>();
        allBody.GetProperty("total").GetInt32().ShouldBe(2);

        var drafts = await _client.GetAsync("/api/v1/practice-assignments?status=draft");
        var draftsBody = await drafts.Content.ReadFromJsonAsync<JsonElement>();
        draftsBody.GetProperty("total").GetInt32().ShouldBe(2);

        var byKeyword = await _client.GetAsync("/api/v1/practice-assignments?keyword=冲刺");
        var keywordBody = await byKeyword.Content.ReadFromJsonAsync<JsonElement>();
        keywordBody.GetProperty("total").GetInt32().ShouldBe(1);
        keywordBody.GetProperty("items").EnumerateArray()
            .Single().GetProperty("title").GetString().ShouldBe("期末冲刺练习");
    }

    [Fact]
    public async Task 开放范围只能选组织标签()
    {
        await LoginAsync(TeacherUsername, TeacherPassword);

        var create = await _client.PostAsJsonAsync(
            "/api/v1/practice-assignments",
            new
            {
                paperId = _paperId,
                title = "范围不合法",
                scopeTagIds = new[] { _knowledgeTagId },
            });

        create.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task 没有练习管理权限就管不了练习()
    {
        await LoginAsync(StudentUsername, StudentPassword);

        var create = await _client.PostAsJsonAsync(
            "/api/v1/practice-assignments",
            new { paperId = _paperId, title = "学生乱建" });

        create.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    private async Task<long> CreateAssignmentAsync(string title)
    {
        var create = await _client.PostAsJsonAsync(
            "/api/v1/practice-assignments",
            new { paperId = _paperId, title, scopeTagIds = Array.Empty<long>() });

        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var body = await create.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("id").GetInt64();
    }

    private async Task<IReadOnlyList<long>> VisiblePracticeIdsAsync()
    {
        var response = await _client.GetAsync("/api/v1/practices");
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("items").EnumerateArray()
            .Select(i => i.GetProperty("id").GetInt64())
            .ToList();
    }

    private async Task<long> CreatePracticePaperAsync()
    {
        await LoginAsync(TeacherUsername, TeacherPassword);

        var now = DateTimeOffset.UtcNow;
        long questionId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var question = Question.CreateDraft("Q-PAM-001", QuestionType.Single, "题干", Score.Question(10), 1, now);
            question.AddOption(QuestionOption.Create("A", "甲", true, 0), now);
            question.AddOption(QuestionOption.Create("B", "乙", false, 1), now);

            await db.Questions.AddAsync(question);
            await db.SaveChangesAsync();

            question.Publish(now);
            await db.SaveChangesAsync();

            questionId = question.Id;
        }

        var create = await _client.PostAsJsonAsync(
            "/api/v1/papers",
            new { kind = "practice", name = "管理端练习卷", targetTotalScore = 10, durationMinutes = 30 });
        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var paperBody = await create.Content.ReadFromJsonAsync<JsonElement>();
        var paperId = paperBody.GetProperty("paper").GetProperty("id").GetInt64();

        var add = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/items",
            new { questionId, score = 10m });
        add.StatusCode.ShouldBe(HttpStatusCode.OK, await add.Content.ReadAsStringAsync());

        var publish = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/publish",
            new { warningOverrideReason = "用于验证练习管理" });
        publish.StatusCode.ShouldBe(HttpStatusCode.OK, await publish.Content.ReadAsStringAsync());

        return paperId;
    }

    private async Task LoginAsync(string username, string password)
    {
        var response = await _client.PostAsJsonAsync("/api/v1/auth/login", new { username, password });
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        _client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", body.GetProperty("accessToken").GetString());
    }

    private static async Task<long> SeedTagAsync(AppDbContext db, string code, string name, TagGroup group)
    {
        var now = DateTimeOffset.UtcNow;
        var tag = Tag.Create(code, name, group, null, null, 0, now);

        await db.Tags.AddAsync(tag);
        await db.SaveChangesAsync();

        return tag.Id;
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

    private static async Task<long> SeedUserAsync(AppDbContext db, string username, string password, long roleId)
    {
        var verifier = new Pbkdf2PasswordVerifier();
        var now = DateTimeOffset.UtcNow;

        var user = User.Register(username, username, verifier.Hash(password), now);
        await db.Users.AddAsync(user);
        await db.SaveChangesAsync();

        await db.UserRoles.AddAsync(UserRole.Create(user.Id, roleId, null, now));
        await db.SaveChangesAsync();

        return user.Id;
    }
}

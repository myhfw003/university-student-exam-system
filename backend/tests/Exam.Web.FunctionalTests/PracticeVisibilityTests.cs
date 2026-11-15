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
/// 练习开放单的可见性。
/// <para>
/// 开放范围是组织标签：不在范围内的学生**看不到**这个练习，详情也拿不到。
/// </para>
/// </summary>
public sealed class PracticeVisibilityTests : IAsyncLifetime
{
    private const string TeacherUsername = "praceteacher1";
    private const string TeacherPassword = "Passw0rd!";
    private const string ClassStudentUsername = "practicestudent1";
    private const string OutsiderUsername = "practicestudent2";
    private const string StudentPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _classTagId;
    private long _scopedPracticeId;
    private long _openPracticeId;

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
            "practice_teacher",
            PermissionCatalog.PaperRead,
            PermissionCatalog.PaperWrite,
            PermissionCatalog.PaperPublish,
            PermissionCatalog.QuestionRead,
            PermissionCatalog.QuestionPublish,
            PermissionCatalog.TagRead,
            PermissionCatalog.UserTagAssign);

        await SeedUserAsync(db, TeacherUsername, TeacherPassword, teacherRoleId);

        var studentRoleId = await SeedRoleAsync(db, "practice_student", PermissionCatalog.AttemptTake, PermissionCatalog.AttemptReadOwn);
        var classStudentId = await SeedUserAsync(db, ClassStudentUsername, StudentPassword, studentRoleId);
        await SeedUserAsync(db, OutsiderUsername, StudentPassword, studentRoleId);

        // 班级标签：只有班上这名学生挂了它。
        _classTagId = await SeedTagAsync(db, "practice.class", "计科 2301 班", TagGroup.Organization);
        await db.UserTags.AddAsync(UserTag.Create(classStudentId, _classTagId, DateTimeOffset.UtcNow));
        await db.SaveChangesAsync();

        var paperId = await CreatePracticePaperAsync();

        // 限定班级范围的练习，以及全员可见的练习。
        _scopedPracticeId = await SeedPracticeAsync(db, paperId, "计科 2301 班 · 期末专项练习", [_classTagId]);
        _openPracticeId = await SeedPracticeAsync(db, paperId, "全员可见 · 期末专项练习", []);
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 范围内的学生能看到练习()
    {
        await LoginAsync(ClassStudentUsername, StudentPassword);

        var body = await GetPracticesAsync();
        var ids = body.GetProperty("items").EnumerateArray()
            .Select(i => i.GetProperty("id").GetInt64())
            .ToList();

        ids.ShouldContain(_scopedPracticeId);
        ids.ShouldContain(_openPracticeId);
        body.GetProperty("total").GetInt32().ShouldBe(2);

        var scoped = body.GetProperty("items").EnumerateArray()
            .Single(i => i.GetProperty("id").GetInt64() == _scopedPracticeId);

        scoped.GetProperty("title").GetString().ShouldBe("计科 2301 班 · 期末专项练习");
        scoped.GetProperty("questionCount").GetInt32().ShouldBe(2);
        scoped.GetProperty("totalScore").GetDecimal().ShouldBe(20m);
        scoped.GetProperty("canStart").GetBoolean().ShouldBeTrue();
        scoped.GetProperty("usedAttempts").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task 范围外的学生看不到限定范围的练习()
    {
        await LoginAsync(OutsiderUsername, StudentPassword);

        var body = await GetPracticesAsync();
        var ids = body.GetProperty("items").EnumerateArray()
            .Select(i => i.GetProperty("id").GetInt64())
            .ToList();

        ids.ShouldNotContain(_scopedPracticeId);
        ids.ShouldContain(_openPracticeId);
        body.GetProperty("total").GetInt32().ShouldBe(1);

        // 详情也拿不到：不在范围内就当没有这个练习。
        var detail = await _client.GetAsync($"/api/v1/practices/{_scopedPracticeId}");
        detail.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task 可以按关键词与标签过滤()
    {
        await LoginAsync(ClassStudentUsername, StudentPassword);

        var byKeyword = await _client.GetAsync("/api/v1/practices?keyword=全员");
        byKeyword.StatusCode.ShouldBe(HttpStatusCode.OK);

        var keywordBody = await byKeyword.Content.ReadFromJsonAsync<JsonElement>();
        keywordBody.GetProperty("total").GetInt32().ShouldBe(1);
        keywordBody.GetProperty("items").EnumerateArray()
            .Single().GetProperty("id").GetInt64().ShouldBe(_openPracticeId);

        var byTag = await _client.GetAsync("/api/v1/practices?tagId=0");
        byTag.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    private async Task<JsonElement> GetPracticesAsync()
    {
        var response = await _client.GetAsync("/api/v1/practices");
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private async Task<long> CreatePracticePaperAsync()
    {
        await LoginAsync(TeacherUsername, TeacherPassword);

        var questionIds = new List<long>();
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var now = DateTimeOffset.UtcNow;

            foreach (var code in new[] { "Q-PRC-001", "Q-PRC-002" })
            {
                var question = Question.CreateDraft(code, QuestionType.Single, "题干", Score.Question(10), 1, now);
                question.AddOption(QuestionOption.Create("A", "甲", true, 0), now);
                question.AddOption(QuestionOption.Create("B", "乙", false, 1), now);

                await db.Questions.AddAsync(question);
                await db.SaveChangesAsync();

                question.Publish(now);
                await db.SaveChangesAsync();

                questionIds.Add(question.Id);
            }
        }

        var create = await _client.PostAsJsonAsync(
            "/api/v1/papers",
            new
            {
                kind = "practice",
                name = "期末专项练习卷",
                targetTotalScore = 20,
                durationMinutes = 30,
            });
        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var paperBody = await create.Content.ReadFromJsonAsync<JsonElement>();
        var paperId = paperBody.GetProperty("paper").GetProperty("id").GetInt64();

        foreach (var questionId in questionIds)
        {
            var add = await _client.PostAsJsonAsync(
                $"/api/v1/papers/{paperId}/items",
                new { questionId, score = 10m });
            add.StatusCode.ShouldBe(HttpStatusCode.OK, await add.Content.ReadAsStringAsync());
        }

        var publish = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/publish",
            new { warningOverrideReason = "用于验证练习可见性" });
        publish.StatusCode.ShouldBe(HttpStatusCode.OK, await publish.Content.ReadAsStringAsync());

        return paperId;
    }

    private static async Task<long> SeedPracticeAsync(
        AppDbContext db,
        long paperId,
        string title,
        IReadOnlyCollection<long> scopeTagIds)
    {
        var now = DateTimeOffset.UtcNow;
        var assignment = PracticeAssignment.Create(paperId, title, scopeTagIds, now, null, now);
        assignment.Publish(now);

        await db.PracticeAssignments.AddAsync(assignment);
        await db.SaveChangesAsync();

        return assignment.Id;
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

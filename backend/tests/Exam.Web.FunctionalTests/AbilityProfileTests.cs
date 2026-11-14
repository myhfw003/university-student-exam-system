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
/// 能力画像：成绩定分驱动更新，样本不足的不参与排序。
/// </summary>
public sealed class AbilityProfileTests : IAsyncLifetime
{
    private const string TeacherUsername = "abilityteacher1";
    private const string TeacherPassword = "Passw0rd!";
    private const string StudentUsername = "abilitystudent1";
    private const string OtherStudentUsername = "abilitystudent2";
    private const string StudentPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _singleQuestionId;
    private long _abilityTagId;
    private long _knowledgeTagId;
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
            "ability_teacher",
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

        var studentRoleId = await SeedRoleAsync(db, "ability_student", PermissionCatalog.AttemptTake, PermissionCatalog.AttemptReadOwn);
        await SeedUserAsync(db, StudentUsername, StudentPassword, studentRoleId);
        await SeedUserAsync(db, OtherStudentUsername, StudentPassword, studentRoleId);

        _abilityTagId = await SeedTagAsync(db, "ability_tag", "计算能力", TagGroup.Ability);
        _knowledgeTagId = await SeedTagAsync(db, "knowledge_tag", "知识点", TagGroup.KnowledgePoint);
        var difficultyTagId = await SeedTagAsync(db, "difficulty_tag", "难度", TagGroup.Difficulty, level: 3);

        _singleQuestionId = await SeedSingleQuestionAsync(
            db,
            "Q-ABI-001",
            difficultyTagId,
            _abilityTagId,
            _knowledgeTagId);
        _sessionId = await CreateSessionAsync();
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 交卷后能力画像更新()
    {
        await TakeExamAsync(correct: true);

        await LoginAsync(StudentUsername, StudentPassword);
        var profile = await _client.GetAsync("/api/v1/abilities/profile");
        profile.StatusCode.ShouldBe(HttpStatusCode.OK, await profile.Content.ReadAsStringAsync());

        var body = await profile.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("total").GetInt32().ShouldBe(1);

        var item = body.GetProperty("items")[0];
        item.GetProperty("abilityTagId").GetInt64().ShouldBe(_abilityTagId);
        item.GetProperty("tagName").GetString().ShouldBe("计算能力");
        item.GetProperty("sampleSize").GetInt32().ShouldBe(1);
        item.GetProperty("correctCount").GetInt32().ShouldBe(1);
        item.GetProperty("masteryRate").GetDecimal().ShouldBeGreaterThan(0m);

        // 样本只有 1 个：标「样本不足」，不参与排序。
        item.GetProperty("sampleSufficient").GetBoolean().ShouldBeFalse();
        item.GetProperty("masteryLabel").GetString().ShouldBe("样本不足");
        body.GetProperty("insufficientCount").GetInt32().ShouldBe(1);
    }

    [Fact]
    public async Task 知识点标签不进能力画像()
    {
        await TakeExamAsync(correct: true);

        await LoginAsync(StudentUsername, StudentPassword);
        var profile = await _client.GetAsync("/api/v1/abilities/profile");
        var body = await profile.Content.ReadFromJsonAsync<JsonElement>();

        body.GetProperty("total").GetInt32().ShouldBe(1);

        var tagIds = body.GetProperty("items")
            .EnumerateArray()
            .Select(i => i.GetProperty("abilityTagId").GetInt64())
            .ToList();

        tagIds.ShouldNotContain(_knowledgeTagId);
        tagIds.ShouldContain(_abilityTagId);
    }

    [Fact]
    public async Task 样本够了就参与排序()
    {
        // 做满 5 次，样本量才够。
        for (var i = 0; i < 5; i++)
        {
            await TakeExamAsync(correct: true);
        }

        await LoginAsync(StudentUsername, StudentPassword);
        var profile = await _client.GetAsync("/api/v1/abilities/profile");
        var body = await profile.Content.ReadFromJsonAsync<JsonElement>();

        var item = body.GetProperty("items")[0];
        item.GetProperty("sampleSize").GetInt32().ShouldBe(5);
        item.GetProperty("sampleSufficient").GetBoolean().ShouldBeTrue();
        // 全对五次：掌握度够高，评「掌握」。
        item.GetProperty("masteryLabel").GetString().ShouldBe("掌握");
        body.GetProperty("insufficientCount").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task 别人的画像看不到()
    {
        await TakeExamAsync(correct: true);

        await LoginAsync(StudentUsername, StudentPassword);
        var profile = await _client.GetAsync("/api/v1/abilities/profile");
        var body = await profile.Content.ReadFromJsonAsync<JsonElement>();

        body.GetProperty("total").GetInt32().ShouldBe(1);

        // 另一个学生登录：自己的画像是空的。
        await LoginAsync(OtherStudentUsername, StudentPassword);
        var otherProfile = await _client.GetAsync("/api/v1/abilities/profile");
        otherProfile.StatusCode.ShouldBe(HttpStatusCode.OK, await otherProfile.Content.ReadAsStringAsync());
        var otherBody = await otherProfile.Content.ReadFromJsonAsync<JsonElement>();
        otherBody.GetProperty("total").GetInt32().ShouldBe(0);
    }

    /// <summary>考一次（客观题答对或答错）。</summary>
    private async Task TakeExamAsync(bool correct)
    {
        await LoginAsync(StudentUsername, StudentPassword);

        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { examSessionId = _sessionId });
        start.StatusCode.ShouldBe(HttpStatusCode.OK, await start.Content.ReadAsStringAsync());

        var startBody = await start.Content.ReadFromJsonAsync<JsonElement>();
        var attemptId = startBody.GetProperty("attemptId").GetInt64();

        var save = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/answers",
            new
            {
                clientSeq = 1,
                items = new[]
                {
                    new
                    {
                        questionId = _singleQuestionId,
                        payload = new { selectedOptionKeys = correct ? new[] { "A" } : new[] { "B" } },
                    },
                },
            });
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
                name = "能力画像测试考试",
                targetTotalScore = 10,
                durationMinutes = 15,
                allowRetake = true,
            });
        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var paperBody = await create.Content.ReadFromJsonAsync<JsonElement>();
        var paperId = paperBody.GetProperty("paper").GetProperty("id").GetInt64();

        var add = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/items",
            new { questionId = _singleQuestionId, score = 10m });
        add.StatusCode.ShouldBe(HttpStatusCode.OK, await add.Content.ReadAsStringAsync());

        var publishPaper = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/publish",
            new { warningOverrideReason = "用于验证能力画像" });
        publishPaper.StatusCode.ShouldBe(HttpStatusCode.OK, await publishPaper.Content.ReadAsStringAsync());

        var session = await _client.PostAsJsonAsync(
            "/api/v1/exam-sessions",
            new
            {
                paperId,
                name = "能力画像测试考试",
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

    private static async Task<long> SeedTagAsync(
        AppDbContext db,
        string code,
        string name,
        TagGroup group,
        int? level = null)
    {
        var now = DateTimeOffset.UtcNow;
        var tag = Tag.Create(code, name, group, level, null, 0, now);
        await db.Tags.AddAsync(tag);
        await db.SaveChangesAsync();

        return tag.Id;
    }

    private static async Task<long> SeedSingleQuestionAsync(
        AppDbContext db,
        string code,
        long difficultyTagId,
        long abilityTagId,
        long knowledgeTagId)
    {
        var now = DateTimeOffset.UtcNow;
        var question = Question.CreateDraft(code, QuestionType.Single, "单选题题干", Score.Question(10), difficultyTagId, now);
        question.AddOption(QuestionOption.Create("A", "甲", true, 0), now);
        question.AddOption(QuestionOption.Create("B", "乙", false, 1), now);

        await db.Questions.AddAsync(question);
        await db.SaveChangesAsync();

        // 能力标签与知识点标签各挂一个：只有能力维度的进画像。
        question.AttachTag(abilityTagId, now);
        question.AttachTag(knowledgeTagId, now);
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

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

/// <summary>名单物化的端到端测试：发布时展开名单，之后与标签解耦。</summary>
public sealed class ExamParticipantEndpointTests : IAsyncLifetime
{
    private const string AdminUsername = "rosteradmin1";
    private const string AdminPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _questionId;
    private long _orgParentTagId;
    private long _orgChildTagId;
    private long _taggedUserId;
    private long _untaggedUserId;

    public async Task InitializeAsync()
    {
        await _postgres.StartAsync();

        _factory = new ExamWebFactory(_postgres.GetConnectionString());
        _client = _factory.CreateClient();
        _client.BaseAddress = new Uri("http://localhost");

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.MigrateAsync();

        var roleId = await SeedRoleAsync(db);
        await SeedUserAsync(db, AdminUsername, AdminPassword, roleId);

        var now = DateTimeOffset.UtcNow;
        var parent = Tag.Create("org.class", "计算机学院 2301 班", TagGroup.Organization, null, null, 0, now);
        var child = Tag.Create("org.class.grp", "第一组", TagGroup.Organization, null, null, 1, now);
        await db.Tags.AddRangeAsync(parent, child);
        await db.SaveChangesAsync();

        child.SetParent(parent, now);
        await db.SaveChangesAsync();

        _orgParentTagId = parent.Id;
        _orgChildTagId = child.Id;

        _questionId = await SeedQuestionAsync(db, "Q-ROS-001");
        _taggedUserId = await SeedStudentAsync(db, "rostertag001", child.Id);
        _untaggedUserId = await SeedStudentAsync(db, "rosterplain001", null);
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 按组织标签纳入时名单含子标签下的考生()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync(publishPaper: true);
        var sessionId = await CreateSessionAsync(paperId, "tags", new[] { _orgParentTagId });

        await _client.PostAsync($"/api/v1/exam-sessions/{sessionId}/publish", null);

        var roster = await _client.GetAsync($"/api/v1/exam-sessions/{sessionId}/participants");
        roster.StatusCode.ShouldBe(HttpStatusCode.OK, await roster.Content.ReadAsStringAsync());

        var body = await roster.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("total").GetInt32().ShouldBe(1);

        var item = body.GetProperty("items")[0];
        item.GetProperty("userId").GetInt64().ShouldBe(_taggedUserId);
        item.GetProperty("status").GetString().ShouldBe("invited");
    }

    [Fact]
    public async Task 全员开放时不物化名单()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync(publishPaper: true);
        var sessionId = await CreateSessionAsync(paperId, "open", null);

        await _client.PostAsync($"/api/v1/exam-sessions/{sessionId}/publish", null);

        var roster = await _client.GetAsync($"/api/v1/exam-sessions/{sessionId}/participants");
        var body = await roster.Content.ReadFromJsonAsync<JsonElement>();

        body.GetProperty("total").GetInt32().ShouldBe(0);
        body.GetProperty("participantMode").GetString().ShouldBe("open");
    }

    [Fact]
    public async Task 指定考生时名单只有指定的人()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync(publishPaper: true);
        var sessionId = await CreateSessionAsync(paperId, "direct", null, new[] { _untaggedUserId });

        await _client.PostAsync($"/api/v1/exam-sessions/{sessionId}/publish", null);

        var roster = await _client.GetAsync($"/api/v1/exam-sessions/{sessionId}/participants");
        var body = await roster.Content.ReadFromJsonAsync<JsonElement>();

        body.GetProperty("total").GetInt32().ShouldBe(1);
        body.GetProperty("items")[0].GetProperty("userId").GetInt64().ShouldBe(_untaggedUserId);
    }

    [Fact]
    public async Task 发布后名单不再随标签变化()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync(publishPaper: true);
        var sessionId = await CreateSessionAsync(paperId, "tags", new[] { _orgParentTagId });

        await _client.PostAsync($"/api/v1/exam-sessions/{sessionId}/publish", null);

        // 把挂标签的考生改成另一个班，名单也不该变。
        await MoveUserTagAsync(_taggedUserId, _orgChildTagId, null);

        var roster = await _client.GetAsync($"/api/v1/exam-sessions/{sessionId}/participants");
        var body = await roster.Content.ReadFromJsonAsync<JsonElement>();

        body.GetProperty("total").GetInt32().ShouldBe(1);
        body.GetProperty("items")[0].GetProperty("userId").GetInt64().ShouldBe(_taggedUserId);
    }

    [Fact]
    public async Task 设置名单会重新物化()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync(publishPaper: true);
        var sessionId = await CreateSessionAsync(paperId, "open", null);

        await _client.PostAsync($"/api/v1/exam-sessions/{sessionId}/publish", null);

        var set = await _client.PutAsJsonAsync(
            $"/api/v1/exam-sessions/{sessionId}/participants",
            new { participantTagIds = new[] { _orgParentTagId } });
        set.StatusCode.ShouldBe(HttpStatusCode.OK, await set.Content.ReadAsStringAsync());

        var body = await set.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("total").GetInt32().ShouldBe(1);
        body.GetProperty("participantMode").GetString().ShouldBe("tags");
    }

    [Fact]
    public async Task 非组织维度标签不能作为名单()
    {
        await LoginAsync();

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var now = DateTimeOffset.UtcNow;
        var difficulty = Tag.Create("difficulty.easy", "简单", TagGroup.Difficulty, 1, null, 0, now);
        await db.Tags.AddAsync(difficulty);
        await db.SaveChangesAsync();

        var paperId = await CreatePaperAsync(publishPaper: true);
        var sessionId = await CreateSessionAsync(paperId, "tags", new[] { difficulty.Id });

        var publish = await _client.PostAsync($"/api/v1/exam-sessions/{sessionId}/publish", null);
        publish.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
    }

    private async Task MoveUserTagAsync(long userId, long? fromTagId, long? toTagId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var links = await db.UserTags.Where(t => t.UserId == userId).ToListAsync();
        db.UserTags.RemoveRange(links);

        if (toTagId is not null)
        {
            await db.UserTags.AddAsync(UserTag.Create(userId, toTagId.Value, DateTimeOffset.UtcNow));
        }

        await db.SaveChangesAsync();
    }

    private async Task<long> CreateSessionAsync(
        long paperId,
        string participantMode,
        long[]? tagIds = null,
        long[]? userIds = null)
    {
        var create = await _client.PostAsJsonAsync(
            "/api/v1/exam-sessions",
            new
            {
                paperId,
                name = "计算机网络期中考试",
                openAt = DateTimeOffset.UtcNow.AddMinutes(-5),
                closeAt = DateTimeOffset.UtcNow.AddHours(4),
                durationMinutes = 90,
                participantMode,
                participantTagIds = tagIds,
                participantUserIds = userIds,
            });
        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var body = await create.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("session").GetProperty("id").GetInt64();
    }

    private async Task<long> CreatePaperAsync(bool publishPaper = false)
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

        var body = await create.Content.ReadFromJsonAsync<JsonElement>();
        var paperId = body.GetProperty("paper").GetProperty("id").GetInt64();

        var add = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/items",
            new { questionId = _questionId, score = 10m });
        add.StatusCode.ShouldBe(HttpStatusCode.OK, await add.Content.ReadAsStringAsync());

        if (publishPaper)
        {
            var publish = await _client.PostAsync($"/api/v1/papers/{paperId}/publish", null);
            publish.StatusCode.ShouldBe(HttpStatusCode.OK, await publish.Content.ReadAsStringAsync());
        }

        return paperId;
    }

    private async Task LoginAsync()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/v1/auth/login",
            new { username = AdminUsername, password = AdminPassword });

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

    private static async Task<long> SeedStudentAsync(AppDbContext db, string username, long? tagId)
    {
        var verifier = new Pbkdf2PasswordVerifier();
        var now = DateTimeOffset.UtcNow;

        var user = User.Register(username, username, verifier.Hash("Passw0rd!"), now);
        await db.Users.AddAsync(user);
        await db.SaveChangesAsync();

        if (tagId is not null)
        {
            await db.UserTags.AddAsync(UserTag.Create(user.Id, tagId.Value, now));
            await db.SaveChangesAsync();
        }

        return user.Id;
    }

    private static async Task<long> SeedRoleAsync(AppDbContext db)
    {
        var now = DateTimeOffset.UtcNow;
        var role = Role.Create("roster_admin", "名单管理员", now);
        await db.Roles.AddAsync(role);
        await db.SaveChangesAsync();

        string[] codes =
        [
            PermissionCatalog.ExamRead,
            PermissionCatalog.ExamWrite,
            PermissionCatalog.ExamPublish,
            PermissionCatalog.PaperRead,
            PermissionCatalog.PaperWrite,
            PermissionCatalog.PaperPublish,
            PermissionCatalog.QuestionRead,
            PermissionCatalog.QuestionPublish,
            PermissionCatalog.TagRead,
            PermissionCatalog.TagWrite,
        ];

        foreach (var code in codes)
        {
            var permission = await db.Permissions.FirstOrDefaultAsync(p => p.Code == code);
            if (permission is null)
            {
                permission = Permission.Create(code, code, code.Split(':')[0]);
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

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
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

/// <summary>场次名单 CSV 导入的端到端测试。</summary>
public sealed class ExamParticipantImportTests : IAsyncLifetime
{
    private const string AdminUsername = "importadmin1";
    private const string AdminPassword = "Passw0rd!";
    private const string StudentOne = "importstu001";
    private const string StudentTwo = "importstu002";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _questionId;
    private long _studentOneId;
    private long _studentTwoId;

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

        _questionId = await SeedQuestionAsync(db, "Q-IMP-001");
        _studentOneId = await SeedStudentAsync(db, StudentOne, "学生一");
        _studentTwoId = await SeedStudentAsync(db, StudentTwo, "学生二");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 导入名单后口径切到指定考生且发布后名单一致()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync();
        var sessionId = await CreateSessionAsync(paperId);

        var import = await ImportAsync(sessionId, Csv(StudentOne, StudentTwo));
        import.StatusCode.ShouldBe(HttpStatusCode.OK, await import.Content.ReadAsStringAsync());

        var body = await import.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("total").GetInt32().ShouldBe(2);
        body.GetProperty("imported").GetInt32().ShouldBe(2);
        body.GetProperty("skipped").GetArrayLength().ShouldBe(0);
        body.GetProperty("participantMode").GetString().ShouldBe("direct");

        // 发布后名单就是导入的两个人。
        await _client.PostAsync($"/api/v1/exam-sessions/{sessionId}/publish", null);

        var roster = await _client.GetAsync($"/api/v1/exam-sessions/{sessionId}/participants");
        roster.StatusCode.ShouldBe(HttpStatusCode.OK, await roster.Content.ReadAsStringAsync());

        var rosterBody = await roster.Content.ReadFromJsonAsync<JsonElement>();
        rosterBody.GetProperty("total").GetInt32().ShouldBe(2);

        var ids = rosterBody.GetProperty("items")
            .EnumerateArray()
            .Select(item => item.GetProperty("userId").GetInt64())
            .OrderBy(id => id)
            .ToArray();
        ids.ShouldBe(new[] { _studentOneId, _studentTwoId }.OrderBy(id => id).ToArray());
    }

    [Fact]
    public async Task 账号不存在的行被跳过并给出原因()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync();
        var sessionId = await CreateSessionAsync(paperId);

        var import = await ImportAsync(sessionId, Csv(StudentOne, "nosuchuser001"));
        import.StatusCode.ShouldBe(HttpStatusCode.OK, await import.Content.ReadAsStringAsync());

        var body = await import.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("imported").GetInt32().ShouldBe(1);
        body.GetProperty("skipped").GetArrayLength().ShouldBe(1);

        var failure = body.GetProperty("skipped")[0];
        failure.GetProperty("account").GetString().ShouldBe("nosuchuser001");
        (failure.GetProperty("reason").GetString() ?? "").ShouldContain("账号不存在");
    }

    [Fact]
    public async Task 一行都没导进去时不动名单()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync();
        var sessionId = await CreateSessionAsync(paperId);

        // 先导入一个人。
        await ImportAsync(sessionId, Csv(StudentOne));

        // 再导一个都不存在的账号：名单不能被清空。
        var import = await ImportAsync(sessionId, Csv("nosuchuser002"));
        var body = await import.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("imported").GetInt32().ShouldBe(0);

        await _client.PostAsync($"/api/v1/exam-sessions/{sessionId}/publish", null);

        var roster = await _client.GetAsync($"/api/v1/exam-sessions/{sessionId}/participants");
        var rosterBody = await roster.Content.ReadFromJsonAsync<JsonElement>();
        rosterBody.GetProperty("total").GetInt32().ShouldBe(1);
        rosterBody.GetProperty("items")[0].GetProperty("userId").GetInt64().ShouldBe(_studentOneId);
    }

    [Fact]
    public async Task 已发布的场次不能再导入名单()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync();
        var sessionId = await CreateSessionAsync(paperId);

        await _client.PostAsync($"/api/v1/exam-sessions/{sessionId}/publish", null);

        var import = await ImportAsync(sessionId, Csv(StudentOne));
        import.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task 缺少账号列的文件被拒绝()
    {
        await LoginAsync();

        var paperId = await CreatePaperAsync();
        var sessionId = await CreateSessionAsync(paperId);

        var import = await ImportAsync(sessionId, "姓名\n张三\n");
        import.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
    }

    /// <summary>上传名单文件（multipart）。</summary>
    private async Task<HttpResponseMessage> ImportAsync(long sessionId, string csv)
    {
        using var content = new MultipartFormDataContent();
        var bytes = new ByteArrayContent(Encoding.UTF8.GetBytes(csv));
        bytes.Headers.ContentType = new MediaTypeHeaderValue("text/csv");
        content.Add(bytes, "file", "roster.csv");

        return await _client.PostAsync($"/api/v1/exam-sessions/{sessionId}/participants/import", content);
    }

    private static string Csv(params string[] accounts)
    {
        var builder = new StringBuilder("账号,姓名\n");
        foreach (var account in accounts)
        {
            builder.Append(account).Append(',').Append(account).Append('\n');
        }

        return builder.ToString();
    }

    private async Task<long> CreateSessionAsync(long paperId)
    {
        var create = await _client.PostAsJsonAsync(
            "/api/v1/exam-sessions",
            new
            {
                paperId,
                name = "名单导入考试",
                openAt = DateTimeOffset.UtcNow.AddMinutes(30),
                closeAt = DateTimeOffset.UtcNow.AddHours(4),
                durationMinutes = 90,
                participantMode = "open",
            });
        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var body = await create.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("session").GetProperty("id").GetInt64();
    }

    private async Task<long> CreatePaperAsync()
    {
        var create = await _client.PostAsJsonAsync(
            "/api/v1/papers",
            new
            {
                kind = "exam",
                name = "名单导入试卷",
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

        var publish = await _client.PostAsync($"/api/v1/papers/{paperId}/publish", null);
        publish.StatusCode.ShouldBe(HttpStatusCode.OK, await publish.Content.ReadAsStringAsync());

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

    private static async Task<long> SeedStudentAsync(AppDbContext db, string username, string displayName)
    {
        var verifier = new Pbkdf2PasswordVerifier();
        var now = DateTimeOffset.UtcNow;

        var user = User.Register(username, displayName, verifier.Hash("Passw0rd!"), now);
        await db.Users.AddAsync(user);
        await db.SaveChangesAsync();

        return user.Id;
    }

    private static async Task<long> SeedRoleAsync(AppDbContext db)
    {
        var now = DateTimeOffset.UtcNow;
        var role = Role.Create("import_admin", "名单导入管理员", now);
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

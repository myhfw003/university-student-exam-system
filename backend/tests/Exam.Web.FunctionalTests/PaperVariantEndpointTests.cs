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

/// <summary>卷面派生的端到端测试：同一考生重进卷面一致，不同考生卷面不同。</summary>
public sealed class PaperVariantEndpointTests : IAsyncLifetime
{
    private const string AdminUsername = "variantadmin1";
    private const string AdminPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _questionId;

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

        _questionId = await SeedQuestionAsync(db, "Q-VAR-001");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 标准卷预览题序与选项都不变()
    {
        await LoginAsync();

        var paperId = await CreatePublishedPaperAsync("standard");

        var preview = await _client.GetAsync($"/api/v1/papers/{paperId}/preview?studentKey=stu-1&sessionSeed=s-1");
        preview.StatusCode.ShouldBe(HttpStatusCode.OK, await preview.Content.ReadAsStringAsync());

        var body = await preview.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("variantKey").GetString().ShouldBe("STD");
        body.GetProperty("rule").GetString().ShouldBe("standard");
        body.GetProperty("itemCount").GetInt32().ShouldBe(1);

        var options = body.GetProperty("items")[0].GetProperty("options");
        options.EnumerateArray().Select(o => o.GetProperty("key").GetString())
            .ShouldBe(["A", "B", "C", "D"]);
    }

    [Fact]
    public async Task 小梅花同一考生两次预览一致()
    {
        await LoginAsync();

        var paperId = await CreatePublishedPaperAsync("small_plum");

        var first = await _client.GetAsync($"/api/v1/papers/{paperId}/preview?studentKey=stu-1&sessionSeed=s-1");
        first.StatusCode.ShouldBe(HttpStatusCode.OK, await first.Content.ReadAsStringAsync());
        var firstBody = await first.Content.ReadFromJsonAsync<JsonElement>();

        var second = await _client.GetAsync($"/api/v1/papers/{paperId}/preview?studentKey=stu-1&sessionSeed=s-1");
        second.StatusCode.ShouldBe(HttpStatusCode.OK);
        var secondBody = await second.Content.ReadFromJsonAsync<JsonElement>();

        secondBody.GetProperty("variantKey").GetString().ShouldBe(firstBody.GetProperty("variantKey").GetString());
        OptionKeys(secondBody).ShouldBe(OptionKeys(firstBody));
    }

    [Fact]
    public async Task 小梅花不同考生卷面不同()
    {
        await LoginAsync();

        var paperId = await CreatePublishedPaperAsync("small_plum");

        var first = await _client.GetAsync($"/api/v1/papers/{paperId}/preview?studentKey=stu-1&sessionSeed=s-1");
        var firstBody = await first.Content.ReadFromJsonAsync<JsonElement>();

        var second = await _client.GetAsync($"/api/v1/papers/{paperId}/preview?studentKey=stu-2&sessionSeed=s-1");
        var secondBody = await second.Content.ReadFromJsonAsync<JsonElement>();

        secondBody.GetProperty("variantKey").GetString()
            .ShouldNotBe(firstBody.GetProperty("variantKey").GetString());
    }

    [Fact]
    public async Task 预览不含正确答案()
    {
        await LoginAsync();

        var paperId = await CreatePublishedPaperAsync("small_plum");

        var preview = await _client.GetAsync($"/api/v1/papers/{paperId}/preview?studentKey=stu-1&sessionSeed=s-1");
        var body = await preview.Content.ReadFromJsonAsync<JsonElement>();

        body.GetProperty("items")[0].TryGetProperty("correctKeys", out _).ShouldBeFalse();
    }

    [Fact]
    public async Task 未发布的试卷不能预览()
    {
        await LoginAsync();

        var create = await _client.PostAsJsonAsync(
            "/api/v1/papers",
            new
            {
                kind = "exam",
                name = "计算机网络期中考试",
                targetTotalScore = 10,
                durationMinutes = 15,
                variantRule = "small_plum",
            });
        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var body = await create.Content.ReadFromJsonAsync<JsonElement>();
        var paperId = body.GetProperty("paper").GetProperty("id").GetInt64();

        var preview = await _client.GetAsync($"/api/v1/papers/{paperId}/preview?studentKey=stu-1");
        preview.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    private static List<string> OptionKeys(JsonElement body) =>
        body.GetProperty("items").EnumerateArray()
            .Select(i => string.Join(",", i.GetProperty("options").EnumerateArray().Select(o => o.GetProperty("key").GetString())))
            .ToList();

    private async Task<long> CreatePublishedPaperAsync(string variantRule)
    {
        var create = await _client.PostAsJsonAsync(
            "/api/v1/papers",
            new
            {
                kind = "exam",
                name = "计算机网络期中考试",
                targetTotalScore = 10,
                durationMinutes = 15,
                variantRule,
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
        question.AddOption(QuestionOption.Create("C", "丙", false, 2), now);
        question.AddOption(QuestionOption.Create("D", "丁", false, 3), now);

        await db.Questions.AddAsync(question);
        await db.SaveChangesAsync();

        question.Publish(now);
        await db.SaveChangesAsync();

        return question.Id;
    }

    private static async Task<long> SeedRoleAsync(AppDbContext db)
    {
        var now = DateTimeOffset.UtcNow;
        var role = Role.Create("variant_admin", "卷面管理员", now);
        await db.Roles.AddAsync(role);
        await db.SaveChangesAsync();

        string[] codes =
        [
            PermissionCatalog.PaperRead,
            PermissionCatalog.PaperWrite,
            PermissionCatalog.PaperPublish,
            PermissionCatalog.QuestionRead,
            PermissionCatalog.TagRead,
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

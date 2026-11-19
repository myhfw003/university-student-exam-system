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
/// 题目列表的标签筛选语义（FR-CAT-02）。
///
/// <para>
/// 四格矩阵：任一命中 / 全部命中 × 含子标签 / 不含子标签。
/// 「含子标签」下，命中一个标签的**后代**也算命中这个标签——
/// 这是「全部命中」能落地的前提：否则后代一多，要求全部命中就永远为空。
/// </para>
/// </summary>
public sealed class QuestionTagFilterTests : IAsyncLifetime
{
    private const string AdminUsername = "tagfilter01";
    private const string AdminPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _difficultyTagId;

    /// <summary>父标签「高等数学」。</summary>
    private long _parentTagId;

    /// <summary>子标签「线性代数」（父标签的子标签）。</summary>
    private long _childTagId;

    /// <summary>另一棵树里的标签「计算机网络」。</summary>
    private long _otherTagId;

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

        var difficulty = Tag.Create("difficulty.basic", "基础", TagGroup.Difficulty, 1, null, 0, DateTimeOffset.UtcNow);
        await db.Tags.AddAsync(difficulty);
        await db.SaveChangesAsync();
        _difficultyTagId = difficulty.Id;

        await LoginAsync();

        _parentTagId = await CreateTagAsync("math.advanced", "高等数学", null);
        _childTagId = await CreateTagAsync("math.advanced.linear", "线性代数", _parentTagId);
        _otherTagId = await CreateTagAsync("net.basic", "计算机网络", null);

        // Q1 只挂子标签；Q2 只挂父标签；Q3 挂另一棵树的标签；Q4 同时挂父标签与另一棵树的标签。
        await CreateQuestionAsync("Q-2026-90001", [_childTagId]);
        await CreateQuestionAsync("Q-2026-90002", [_parentTagId]);
        await CreateQuestionAsync("Q-2026-90003", [_otherTagId]);
        await CreateQuestionAsync("Q-2026-90004", [_parentTagId, _otherTagId]);
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 任一命中_含子标签时_后代标签的题目也算命中父标签()
    {
        var codes = await FilterAsync(
            tagIds: [_parentTagId],
            includeDescendants: true,
            matchMode: "any");

        // Q1 只挂子标签，也算命中父标签；Q2 挂父标签；Q3 挂另一棵树；Q4 挂父标签。
        codes.ShouldBe(["Q-2026-90001", "Q-2026-90002", "Q-2026-90004"], ignoreOrder: true);
    }

    [Fact]
    public async Task 任一命中_不含子标签时_只认标签本身()
    {
        var codes = await FilterAsync(
            tagIds: [_parentTagId],
            includeDescendants: false,
            matchMode: "any");

        // Q1 挂的是子标签，父标签本身没挂 → 不算命中。
        codes.ShouldBe(["Q-2026-90002", "Q-2026-90004"], ignoreOrder: true);
    }

    [Fact]
    public async Task 全部命中_含子标签时_后代标签的题目也算命中父标签()
    {
        var codes = await FilterAsync(
            tagIds: [_parentTagId],
            includeDescendants: true,
            matchMode: "all");

        // 只有一个选中标签时，「全部命中」=「任一命中」：命中父标签或它的后代都算。
        codes.ShouldBe(["Q-2026-90001", "Q-2026-90002", "Q-2026-90004"], ignoreOrder: true);
    }

    [Fact]
    public async Task 全部命中_不含子标签时_必须挂中标签本身()
    {
        var codes = await FilterAsync(
            tagIds: [_parentTagId],
            includeDescendants: false,
            matchMode: "all");

        codes.ShouldBe(["Q-2026-90002", "Q-2026-90004"], ignoreOrder: true);
    }

    [Fact]
    public async Task 全部命中_含子标签时_每个选中的标签都要命中()
    {
        var codes = await FilterAsync(
            tagIds: [_parentTagId, _otherTagId],
            includeDescendants: true,
            matchMode: "all");

        // Q1 只命中父标签那一侧；Q3 只命中另一棵树；只有 Q4 两边都命中。
        codes.ShouldBe(["Q-2026-90004"], ignoreOrder: true);
    }

    [Fact]
    public async Task 全部命中_不含子标签时_必须挂中每个标签本身()
    {
        var codes = await FilterAsync(
            tagIds: [_parentTagId, _otherTagId],
            includeDescendants: false,
            matchMode: "all");

        // 只有 Q4 同时挂了两个标签本身。
        codes.ShouldBe(["Q-2026-90004"], ignoreOrder: true);
    }

    [Fact]
    public async Task 命中模式不合法时返回422()
    {
        var response = await _client.GetAsync(
            $"/api/v1/questions?tagIds={_parentTagId}&matchMode=either");

        response.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
    }

    /// <summary>按标签筛选题目，返回命中的题号。</summary>
    private async Task<List<string>> FilterAsync(
        long[] tagIds,
        bool includeDescendants,
        string matchMode)
    {
        var query = string.Join(
            "&",
            tagIds.Select(id => $"tagIds={id}").Append($"includeDescendants={includeDescendants}")
                .Append($"matchMode={matchMode}"));

        var response = await _client.GetAsync($"/api/v1/questions?{query}");
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("items").EnumerateArray()
            .Select(item => item.GetProperty("code").GetString()!)
            .ToList();
    }

    private async Task<long> CreateTagAsync(string code, string name, long? parentId)
    {
        var response = await _client.PostAsJsonAsync(
            "/api/v1/tags",
            new { code, name, group = "domain", parentId, sortOrder = 0 });

        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("id").GetInt64();
    }

    private async Task CreateQuestionAsync(string code, long[] tagIds)
    {
        var response = await _client.PostAsJsonAsync(
            "/api/v1/questions",
            new
            {
                code,
                type = "single",
                stem = "题干",
                defaultScore = 5,
                tagIds,
                difficultyTagId = _difficultyTagId,
                options = new object[]
                {
                    new { key = "A", text = "甲", isCorrect = true },
                    new { key = "B", text = "乙", isCorrect = false },
                },
            });

        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
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

    private static async Task<long> SeedRoleAsync(AppDbContext db)
    {
        var now = DateTimeOffset.UtcNow;
        var role = Role.Create("question_admin", "题目管理员", now);
        await db.Roles.AddAsync(role);
        await db.SaveChangesAsync();

        string[] codes =
        [
            PermissionCatalog.QuestionRead,
            PermissionCatalog.QuestionWrite,
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

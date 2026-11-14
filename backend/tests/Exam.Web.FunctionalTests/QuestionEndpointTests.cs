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

/// <summary>题目与题库端点的端到端测试。</summary>
public sealed class QuestionEndpointTests : IAsyncLifetime
{
    private const string AdminUsername = "qadmin001";
    private const string AdminPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _difficultyTagId;

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

        // 难度标签：题目必须挂一个。
        var difficulty = Tag.Create("difficulty.basic", "基础", TagGroup.Difficulty, 1, null, 0, DateTimeOffset.UtcNow);
        await db.Tags.AddAsync(difficulty);
        await db.SaveChangesAsync();
        _difficultyTagId = difficulty.Id;
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 新建题目_默认是草稿且带选项()
    {
        await LoginAsync();

        var response = await _client.PostAsJsonAsync(
            "/api/v1/questions",
            new
            {
                code = "Q-2026-00001",
                type = "single",
                stem = "下列哪个是正确的？",
                defaultScore = 5,
                difficultyTagId = _difficultyTagId,
                options = new object[]
                {
                    new { key = "A", text = "甲", isCorrect = true },
                    new { key = "B", text = "乙", isCorrect = false },
                },
            });

        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("question").GetProperty("status").GetString().ShouldBe("draft");
        body.GetProperty("options").GetArrayLength().ShouldBe(2);
        body.GetProperty("question").GetProperty("typeLabel").GetString().ShouldBe("单选题");
    }

    [Fact]
    public async Task 发布题目_校验不通过时返回422()
    {
        await LoginAsync();

        var create = await _client.PostAsJsonAsync(
            "/api/v1/questions",
            new
            {
                code = "Q-2026-00002",
                type = "single",
                stem = "没有选项的题",
                defaultScore = 5,
                difficultyTagId = _difficultyTagId,
            });

        create.StatusCode.ShouldBe(HttpStatusCode.OK);
        var created = await create.Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("question").GetProperty("id").GetInt64();

        var publish = await _client.PostAsync($"/api/v1/questions/{id}/publish", null);
        publish.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);

        var problem = await publish.Content.ReadFromJsonAsync<JsonElement>();
        problem.GetProperty("errorCode").GetInt32().ShouldBe(23001);
    }

    [Fact]
    public async Task 停用后可恢复()
    {
        await LoginAsync();

        var id = await CreateSingleQuestionAsync("Q-2026-00003");

        // 草稿不能停用（直接删掉即可），要先发布。
        await _client.PostAsync($"/api/v1/questions/{id}/publish", null);

        var disable = await _client.PostAsync($"/api/v1/questions/{id}/disable", null);
        disable.StatusCode.ShouldBe(HttpStatusCode.OK);

        var disabled = await disable.Content.ReadFromJsonAsync<JsonElement>();
        disabled.GetProperty("question").GetProperty("status").GetString().ShouldBe("disabled");

        var restore = await _client.PostAsync($"/api/v1/questions/{id}/restore", null);
        restore.StatusCode.ShouldBe(HttpStatusCode.OK);

        var restored = await restore.Content.ReadFromJsonAsync<JsonElement>();
        restored.GetProperty("question").GetProperty("status").GetString().ShouldBe("published");
    }

    [Fact]
    public async Task 已发布题目不能删除()
    {
        await LoginAsync();

        var id = await CreateSingleQuestionAsync("Q-2026-00004");
        await _client.PostAsync($"/api/v1/questions/{id}/publish", null);

        var delete = await _client.DeleteAsync($"/api/v1/questions/{id}");
        delete.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task 题号重复时返回409级别的错误码()
    {
        await LoginAsync();

        await CreateSingleQuestionAsync("Q-2026-00005");

        var second = await _client.PostAsJsonAsync(
            "/api/v1/questions",
            new
            {
                code = "Q-2026-00005",
                type = "single",
                stem = "重复题号",
                defaultScore = 5,
                difficultyTagId = _difficultyTagId,
                options = new object[]
                {
                    new { key = "A", text = "甲", isCorrect = true },
                    new { key = "B", text = "乙", isCorrect = false },
                },
            });

        second.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);

        var problem = await second.Content.ReadFromJsonAsync<JsonElement>();
        problem.GetProperty("errorCode").GetInt32().ShouldBe(22001);
    }

    [Fact]
    public async Task 题目列表_关键词命中题号与题干()
    {
        await LoginAsync();

        await CreateSingleQuestionAsync("Q-2026-00006");

        var byCode = await _client.GetAsync("/api/v1/questions?keyword=Q-2026-00006");
        byCode.StatusCode.ShouldBe(HttpStatusCode.OK);

        var body = await byCode.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("total").GetInt32().ShouldBe(1);
        body.GetProperty("items")[0].GetProperty("code").GetString().ShouldBe("Q-2026-00006");

        var byStem = await _client.GetAsync("/api/v1/questions?keyword=下列哪个是正确的");
        byStem.StatusCode.ShouldBe(HttpStatusCode.OK);

        var stemBody = await byStem.Content.ReadFromJsonAsync<JsonElement>();
        stemBody.GetProperty("total").GetInt32().ShouldBeGreaterThan(0);
    }

    [Fact]
    public async Task 题目列表_按状态与题型过滤()
    {
        await LoginAsync();

        var id = await CreateSingleQuestionAsync("Q-2026-00007");
        await _client.PostAsync($"/api/v1/questions/{id}/publish", null);

        var published = await _client.GetAsync("/api/v1/questions?status=published&type=single");
        published.StatusCode.ShouldBe(HttpStatusCode.OK);

        var body = await published.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("total").GetInt32().ShouldBe(1);

        var draft = await _client.GetAsync("/api/v1/questions?status=draft");
        draft.StatusCode.ShouldBe(HttpStatusCode.OK);

        var draftBody = await draft.Content.ReadFromJsonAsync<JsonElement>();
        draftBody.GetProperty("total").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task 批量状态变更_逐条返回成功与失败()
    {
        await LoginAsync();

        var draftId = await CreateSingleQuestionAsync("Q-2026-00008");
        var publishedId = await CreateSingleQuestionAsync("Q-2026-00009");
        await _client.PostAsync($"/api/v1/questions/{publishedId}/publish", null);

        var response = await _client.PostAsJsonAsync(
            "/api/v1/questions/batch-status",
            new { questionIds = new[] { draftId, publishedId, 999999L }, targetStatus = "published" });

        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("total").GetInt32().ShouldBe(3);
        body.GetProperty("succeeded").GetInt32().ShouldBe(2);

        var items = body.GetProperty("items").EnumerateArray()
            .ToDictionary(x => x.GetProperty("questionId").GetInt64(), x => x.GetProperty("succeeded").GetBoolean());

        items[draftId].ShouldBeTrue();
        items[publishedId].ShouldBeTrue();
        items[999999L].ShouldBeFalse();
    }

    [Fact]
    public async Task 题库_移出题目不删除题目本身()
    {
        await LoginAsync();

        var questionId = await CreateSingleQuestionAsync("Q-2026-00010");

        var bankResponse = await _client.PostAsJsonAsync(
            "/api/v1/question-banks",
            new { name = "计算机网络题库" });
        bankResponse.StatusCode.ShouldBe(HttpStatusCode.OK);

        var bank = await bankResponse.Content.ReadFromJsonAsync<JsonElement>();
        var bankId = bank.GetProperty("bank").GetProperty("id").GetInt64();

        var added = await _client.PostAsJsonAsync(
            $"/api/v1/question-banks/{bankId}/items",
            new { questionIds = new[] { questionId } });
        added.StatusCode.ShouldBe(HttpStatusCode.OK);

        var afterAdd = await added.Content.ReadFromJsonAsync<JsonElement>();
        afterAdd.GetProperty("bank").GetProperty("questionCount").GetInt32().ShouldBe(1);
        afterAdd.GetProperty("statistics").GetProperty("total").GetInt32().ShouldBe(1);

        using var removeRequest = new HttpRequestMessage(
            HttpMethod.Delete,
            $"/api/v1/question-banks/{bankId}/items")
        {
            Content = JsonContent.Create(new { questionIds = new[] { questionId } }),
        };

        var removed = await _client.SendAsync(removeRequest);
        removed.StatusCode.ShouldBe(HttpStatusCode.OK);

        var afterRemove = await removed.Content.ReadFromJsonAsync<JsonElement>();
        afterRemove.GetProperty("bank").GetProperty("questionCount").GetInt32().ShouldBe(0);

        // 题目本身还在。
        var question = await _client.GetAsync($"/api/v1/questions/{questionId}");
        question.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task 上传附件_白名单内的图片可以上传并挂到题目上()
    {
        await LoginAsync();

        var questionId = await CreateSingleQuestionAsync("Q-2026-00011");

        var upload = await PostFileAsync(
            "/api/v1/questions/attachments?questionId=" + questionId,
            "diagram.png",
            "image/png",
            PngBytes());

        upload.StatusCode.ShouldBe(HttpStatusCode.OK, await upload.Content.ReadAsStringAsync());

        var uploaded = await upload.Content.ReadFromJsonAsync<JsonElement>();
        uploaded.GetProperty("fileName").GetString().ShouldBe("diagram.png");
        uploaded.GetProperty("id").GetInt64().ShouldBeGreaterThan(0);

        var attachments = await _client.GetAsync($"/api/v1/questions/{questionId}/attachments");
        attachments.StatusCode.ShouldBe(HttpStatusCode.OK);

        var list = await attachments.Content.ReadFromJsonAsync<JsonElement>();
        list.GetArrayLength().ShouldBe(1);

        var attachmentId = list[0].GetProperty("id").GetInt64();
        var url = await _client.GetAsync($"/api/v1/questions/{questionId}/attachments/{attachmentId}/url");
        url.StatusCode.ShouldBe(HttpStatusCode.OK);

        var urlBody = await url.Content.ReadFromJsonAsync<JsonElement>();
        urlBody.GetProperty("url").GetString().ShouldNotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task 上传附件_非白名单类型被拒绝()
    {
        await LoginAsync();

        var upload = await PostFileAsync(
            "/api/v1/questions/attachments",
            "doc.pdf",
            "application/pdf",
            PngBytes());

        upload.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task 上传附件_内容与类型不符被拒绝()
    {
        await LoginAsync();

        // 声明是 png，实际内容是 jpeg。
        var upload = await PostFileAsync(
            "/api/v1/questions/attachments",
            "fake.png",
            "image/png",
            [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);

        upload.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task 题目删除后附件不可访问()
    {
        await LoginAsync();

        var questionId = await CreateSingleQuestionAsync("Q-2026-00012");

        var upload = await PostFileAsync(
            "/api/v1/questions/attachments?questionId=" + questionId,
            "diagram.png",
            "image/png",
            PngBytes());
        upload.StatusCode.ShouldBe(HttpStatusCode.OK);

        var uploaded = await upload.Content.ReadFromJsonAsync<JsonElement>();
        var attachmentId = uploaded.GetProperty("id").GetInt64();

        // 草稿可以删除。
        var delete = await _client.DeleteAsync($"/api/v1/questions/{questionId}");
        delete.StatusCode.ShouldBe(HttpStatusCode.NoContent);

        var url = await _client.GetAsync($"/api/v1/questions/{questionId}/attachments/{attachmentId}/url");
        url.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    private static byte[] PngBytes() =>
        [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x00];

    private async Task<HttpResponseMessage> PostFileAsync(string path, string fileName, string contentType, byte[] content)
    {
        using var body = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(content);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        body.Add(fileContent, "file", fileName);

        return await _client.PostAsync(path, body);
    }

    private async Task<long> CreateSingleQuestionAsync(string code)
    {
        var response = await _client.PostAsJsonAsync(
            "/api/v1/questions",
            new
            {
                code,
                type = "single",
                stem = "下列哪个是正确的？",
                defaultScore = 5,
                difficultyTagId = _difficultyTagId,
                options = new object[]
                {
                    new { key = "A", text = "甲", isCorrect = true },
                    new { key = "B", text = "乙", isCorrect = false },
                },
            });

        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("question").GetProperty("id").GetInt64();
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
            PermissionCatalog.BankRead,
            PermissionCatalog.BankWrite,
            PermissionCatalog.UserRead,
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

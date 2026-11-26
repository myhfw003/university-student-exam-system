using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Exam.Domain.Catalog;
using Exam.Domain.Identity;
using Exam.Infrastructure.Identity;
using Exam.Infrastructure.Persistence;
using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;
using Testcontainers.PostgreSql;

namespace Exam.Web.FunctionalTests;

/// <summary>试题导入端点的端到端测试：上传 → 解析 → 调整映射 → 采纳。</summary>
public sealed class ImportBatchEndpointTests : IAsyncLifetime
{
    private const string AdminUsername = "impadmin01";
    private const string AdminPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;

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

        // 难度与知识点标签：导入时要按名字解析。
        var now = DateTimeOffset.UtcNow;
        await db.Tags.AddAsync(Tag.Create("difficulty.basic", "基础", TagGroup.Difficulty, 1, null, 0, now));
        await db.Tags.AddAsync(Tag.Create("knowledge.limit", "极限", TagGroup.KnowledgePoint, null, null, 0, now));
        await db.SaveChangesAsync();
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 上传CSV_给出列映射建议与逐行结果()
    {
        await LoginAsync();

        var csv = string.Join("\n", [
            "题干,题型,选项,答案,解析,分值,难度,知识点",
            "下列哪个正确？,单选题,A. 甲|B. 乙,A,解析文本,5,基础,极限",
            "缺少选项的题,单选题,,A,,5,基础,",
            "答案越界的题,单选题,A. 甲|B. 乙,C,,5,基础,",
        ]);

        var response = await PostFileAsync("/api/v1/imports", csv, "试题.csv");
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var batch = body.GetProperty("batch");

        batch.GetProperty("totalRows").GetInt32().ShouldBe(3);
        batch.GetProperty("validRows").GetInt32().ShouldBe(1);
        batch.GetProperty("invalidRows").GetInt32().ShouldBe(2);
        batch.GetProperty("fileType").GetString().ShouldBe("csv");

        var mapping = batch.GetProperty("columnMapping");
        mapping.GetProperty("stem").GetString().ShouldBe("题干");
        mapping.GetProperty("type").GetString().ShouldBe("题型");
        mapping.GetProperty("options").GetString().ShouldBe("选项");
        mapping.GetProperty("answer").GetString().ShouldBe("答案");

        var rows = body.GetProperty("rows");
        rows[0].GetProperty("valid").GetBoolean().ShouldBeTrue();
        rows[1].GetProperty("valid").GetBoolean().ShouldBeFalse();
        rows[1].GetProperty("errors")[0].GetProperty("field").GetString().ShouldBe("options");
        rows[2].GetProperty("errors")[0].GetProperty("reason").GetString()!.ShouldContain("不在选项范围内");
    }

    [Fact]
    public async Task 调整列映射后重新解析()
    {
        await LoginAsync();

        // 表头用错列名，猜不出映射；调整映射后应能解析出来。
        var csv = string.Join("\n", [
            "第一列,第二列,第三列,第四列,第五列",
            "下列哪个正确？,单选题,A. 甲|B. 乙,A,基础",
        ]);

        var upload = await PostFileAsync("/api/v1/imports", csv, "试题.csv");
        upload.StatusCode.ShouldBe(HttpStatusCode.OK);

        var uploaded = await upload.Content.ReadFromJsonAsync<JsonElement>();
        var batchId = uploaded.GetProperty("batch").GetProperty("id").GetInt64();
        uploaded.GetProperty("batch").GetProperty("validRows").GetInt32().ShouldBe(0);

        var remap = await _client.PutAsJsonAsync(
            $"/api/v1/imports/{batchId}/mapping",
            new
            {
                mapping = new Dictionary<string, string>
                {
                    ["stem"] = "第一列",
                    ["type"] = "第二列",
                    ["options"] = "第三列",
                    ["answer"] = "第四列",
                    ["difficulty"] = "第五列",
                },
            });

        remap.StatusCode.ShouldBe(HttpStatusCode.OK, await remap.Content.ReadAsStringAsync());

        var remapped = await remap.Content.ReadFromJsonAsync<JsonElement>();
        remapped.GetProperty("batch").GetProperty("validRows").GetInt32().ShouldBe(1);
    }

    [Fact]
    public async Task 采纳批次_生成草稿候选题且重复采纳幂等()
    {
        await LoginAsync();

        var csv = string.Join("\n", [
            "题干,题型,选项,答案,解析,分值,难度,知识点",
            "导入的题目一,单选题,A. 甲|B. 乙,A,解析文本,5,基础,极限",
            "导入的题目二,多选题,A. 甲|B. 乙|C. 丙,\"A,C\",解析文本,8,基础,极限",
        ]);

        var upload = await PostFileAsync("/api/v1/imports", csv, "试题.csv");
        upload.StatusCode.ShouldBe(HttpStatusCode.OK);

        var uploaded = await upload.Content.ReadFromJsonAsync<JsonElement>();
        var batchId = uploaded.GetProperty("batch").GetProperty("id").GetInt64();

        var adopt = await _client.PostAsync($"/api/v1/imports/{batchId}/adopt", null);
        adopt.StatusCode.ShouldBe(HttpStatusCode.OK, await adopt.Content.ReadAsStringAsync());

        var adopted = await adopt.Content.ReadFromJsonAsync<JsonElement>();
        adopted.GetProperty("adopted").GetInt32().ShouldBe(2);
        adopted.GetProperty("alreadyAdopted").GetBoolean().ShouldBeFalse();
        adopted.GetProperty("status").GetString().ShouldBe("adopted");

        // 候选题是草稿，来源标记为 import。
        var questions = await _client.GetAsync("/api/v1/questions?status=draft");
        questions.StatusCode.ShouldBe(HttpStatusCode.OK);

        var list = await questions.Content.ReadFromJsonAsync<JsonElement>();
        list.GetProperty("total").GetInt32().ShouldBe(2);

        var first = list.GetProperty("items")[0];
        first.GetProperty("source").GetString().ShouldBe("import");
        first.GetProperty("status").GetString().ShouldBe("draft");

        // 重复采纳是幂等的：不重复建题。
        var again = await _client.PostAsync($"/api/v1/imports/{batchId}/adopt", null);
        again.StatusCode.ShouldBe(HttpStatusCode.OK);

        var againBody = await again.Content.ReadFromJsonAsync<JsonElement>();
        againBody.GetProperty("alreadyAdopted").GetBoolean().ShouldBeTrue();

        var questionsAgain = await _client.GetAsync("/api/v1/questions?status=draft");
        var listAgain = await questionsAgain.Content.ReadFromJsonAsync<JsonElement>();
        listAgain.GetProperty("total").GetInt32().ShouldBe(2);
    }

    [Fact]
    public async Task 采纳判断题与综合题_选项正确项与步骤参考答案都对()
    {
        await LoginAsync();

        // 判断题的两个选项由聚合根固定创建（A 正确 / B 错误）：
        // 导入时若按文件里的选项再添加一遍，就会「选项 A 重复」而整行失败。
        // 综合题的每个评分步骤都要有参考答案，否则这道题永远发布不了。
        var csv = string.Join("\n", [
            "题干,题型,选项,答案,评分步骤,分值,难度",
            "TCP 用两次握手就能建立连接。,判断题,A. 正确|B. 错误,B,,5,基础",
            "简述 TCP 三次握手的过程。,综合题,,,s1|说明握手过程|10|客户端先发 SYN,10,基础",
        ]);

        var upload = await PostFileAsync("/api/v1/imports", csv, "试题.csv");
        upload.StatusCode.ShouldBe(HttpStatusCode.OK, await upload.Content.ReadAsStringAsync());

        var uploaded = await upload.Content.ReadFromJsonAsync<JsonElement>();
        uploaded.GetProperty("batch").GetProperty("invalidRows").GetInt32().ShouldBe(0);

        var batchId = uploaded.GetProperty("batch").GetProperty("id").GetInt64();
        var adopt = await _client.PostAsync($"/api/v1/imports/{batchId}/adopt", null);
        adopt.StatusCode.ShouldBe(HttpStatusCode.OK, await adopt.Content.ReadAsStringAsync());

        var adopted = await adopt.Content.ReadFromJsonAsync<JsonElement>();
        adopted.GetProperty("adopted").GetInt32().ShouldBe(2);

        var list = await (await _client.GetAsync("/api/v1/questions?status=draft"))
            .Content.ReadFromJsonAsync<JsonElement>();
        var items = list.GetProperty("items").EnumerateArray().ToList();
        items.Count.ShouldBe(2);

        var judge = items.Single(i => i.GetProperty("type").GetString() == "judge");
        var judgeDetail = await (await _client.GetAsync($"/api/v1/questions/{judge.GetProperty("id").GetInt64()}"))
            .Content.ReadFromJsonAsync<JsonElement>();

        var options = judgeDetail.GetProperty("options").EnumerateArray().ToList();
        options.Count.ShouldBe(2);
        options[0].GetProperty("key").GetString().ShouldBe("A");
        options[0].GetProperty("text").GetString().ShouldBe("正确");
        options[0].GetProperty("isCorrect").GetBoolean().ShouldBeFalse();
        options[1].GetProperty("key").GetString().ShouldBe("B");
        options[1].GetProperty("isCorrect").GetBoolean().ShouldBeTrue();

        var comprehensive = items.Single(i => i.GetProperty("type").GetString() == "comprehensive");
        var comprehensiveDetail = await (await _client.GetAsync(
            $"/api/v1/questions/{comprehensive.GetProperty("id").GetInt64()}"))
            .Content.ReadFromJsonAsync<JsonElement>();

        // 步骤的参考答案要带进来：没有它这道题发布校验过不去。
        var steps = comprehensiveDetail.GetProperty("steps").EnumerateArray().ToList();
        steps.Count.ShouldBe(1);
        steps[0].GetProperty("referenceAnswer").GetString().ShouldBe("客户端先发 SYN");
        comprehensiveDetail.GetProperty("question").GetProperty("defaultScore").GetDecimal().ShouldBe(10);
    }

    [Fact]
    public async Task 上传XLSX_能解析首个工作表()
    {
        await LoginAsync();

        var content = BuildXlsx();

        var response = await PostFileAsync("/api/v1/imports", content, "试题.xlsx");
        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("batch").GetProperty("fileType").GetString().ShouldBe("xlsx");
        body.GetProperty("batch").GetProperty("totalRows").GetInt32().ShouldBe(1);
        body.GetProperty("batch").GetProperty("validRows").GetInt32().ShouldBe(1);
    }

    [Fact]
    public async Task 批次详情与列表可查()
    {
        await LoginAsync();

        var csv = string.Join("\n", [
            "题干,题型,选项,答案,分值,难度",
            "查一下我,单选题,A. 甲|B. 乙,A,5,基础",
        ]);

        var upload = await PostFileAsync("/api/v1/imports", csv, "试题.csv");
        var uploaded = await upload.Content.ReadFromJsonAsync<JsonElement>();
        var batchId = uploaded.GetProperty("batch").GetProperty("id").GetInt64();

        var detail = await _client.GetAsync($"/api/v1/imports/{batchId}");
        detail.StatusCode.ShouldBe(HttpStatusCode.OK);

        var detailBody = await detail.Content.ReadFromJsonAsync<JsonElement>();
        detailBody.GetProperty("batch").GetProperty("id").GetInt64().ShouldBe(batchId);
        detailBody.GetProperty("rows").GetArrayLength().ShouldBe(1);

        var list = await _client.GetAsync("/api/v1/imports?page=1&size=10");
        list.StatusCode.ShouldBe(HttpStatusCode.OK);

        var listBody = await list.Content.ReadFromJsonAsync<JsonElement>();
        listBody.GetProperty("total").GetInt32().ShouldBeGreaterThan(0);
    }

    private static byte[] BuildXlsx()
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add("试题");

        sheet.Cell(1, 1).Value = "题干";
        sheet.Cell(1, 2).Value = "题型";
        sheet.Cell(1, 3).Value = "选项";
        sheet.Cell(1, 4).Value = "答案";
        sheet.Cell(1, 5).Value = "分值";
        sheet.Cell(1, 6).Value = "难度";

        sheet.Cell(2, 1).Value = "来自 xlsx 的题目";
        sheet.Cell(2, 2).Value = "单选题";
        sheet.Cell(2, 3).Value = "A. 甲|B. 乙";
        sheet.Cell(2, 4).Value = "A";
        sheet.Cell(2, 5).Value = 5;
        sheet.Cell(2, 6).Value = "基础";

        using var buffer = new MemoryStream();
        workbook.SaveAs(buffer);
        return buffer.ToArray();
    }

    private async Task<HttpResponseMessage> PostFileAsync(string path, byte[] content, string fileName)
    {
        using var body = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(content);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue(
            fileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)
                ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                : "text/csv");
        body.Add(fileContent, "file", fileName);

        return await _client.PostAsync(path, body);
    }

    private async Task<HttpResponseMessage> PostFileAsync(string path, string content, string fileName) =>
        await PostFileAsync(path, Encoding.UTF8.GetBytes(content), fileName);

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
        var role = Role.Create("import_admin", "导入管理员", now);
        await db.Roles.AddAsync(role);
        await db.SaveChangesAsync();

        string[] codes =
        [
            PermissionCatalog.ImportRun,
            PermissionCatalog.ImportAdopt,
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

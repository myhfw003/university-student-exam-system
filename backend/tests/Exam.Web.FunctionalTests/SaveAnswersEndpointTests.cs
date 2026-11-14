using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Exam.Domain.Catalog;
using Exam.Domain.Delivery;
using Exam.Domain.Identity;
using Exam.Infrastructure.Identity;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;
using Testcontainers.PostgreSql;

namespace Exam.Web.FunctionalTests;

/// <summary>答案批量保存的端到端测试：幂等、批次上限、超时拒绝。</summary>
public sealed class SaveAnswersEndpointTests : IAsyncLifetime
{
    private const string TeacherUsername = "answerteacher1";
    private const string TeacherPassword = "Passw0rd!";
    private const string StudentUsername = "answerstudent1";
    private const string StudentPassword = "Passw0rd!";

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

        var teacherRoleId = await SeedRoleAsync(db, "answer_teacher", PermissionCatalog.ExamRead, PermissionCatalog.ExamWrite, PermissionCatalog.ExamPublish, PermissionCatalog.PaperRead, PermissionCatalog.PaperWrite, PermissionCatalog.PaperPublish, PermissionCatalog.QuestionRead, PermissionCatalog.QuestionPublish, PermissionCatalog.TagRead);
        await SeedUserAsync(db, TeacherUsername, TeacherPassword, teacherRoleId);

        var studentRoleId = await SeedRoleAsync(db, "answer_student", PermissionCatalog.AttemptTake, PermissionCatalog.AttemptReadOwn);
        await SeedUserAsync(db, StudentUsername, StudentPassword, studentRoleId);

        _questionId = await SeedQuestionAsync(db, "Q-SAV-001");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 保存答案后能恢复出来()
    {
        var attemptId = await StartAttemptAsync();

        var save = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/answers",
            new
            {
                clientSeq = 1,
                items = new[]
                {
                    new { questionId = _questionId, payload = new { selectedOptionKeys = new[] { "A" } } },
                },
            });

        save.StatusCode.ShouldBe(HttpStatusCode.OK, await save.Content.ReadAsStringAsync());

        var body = await save.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("acceptedClientSeq").GetInt32().ShouldBe(1);
        body.GetProperty("rejected").GetArrayLength().ShouldBe(0);
        body.GetProperty("remainingSeconds").GetInt64().ShouldBeGreaterThan(0);

        var get = await _client.GetAsync($"/api/v1/attempts/{attemptId}");
        var getBody = await get.Content.ReadFromJsonAsync<JsonElement>();

        var answers = getBody.GetProperty("answers");
        answers.GetArrayLength().ShouldBe(1);
        answers[0].GetProperty("questionId").GetInt64().ShouldBe(_questionId);
        answers[0].GetProperty("payload").GetProperty("selectedOptionKeys")[0].GetString().ShouldBe("A");
        getBody.GetProperty("lastClientSeq").GetInt32().ShouldBe(1);
    }

    [Fact]
    public async Task 重复提交同一批不产生重复记录()
    {
        var attemptId = await StartAttemptAsync();

        var request = new
        {
            clientSeq = 5,
            items = new[]
            {
                new { questionId = _questionId, payload = new { selectedOptionKeys = new[] { "A" } } },
            },
        };

        var first = await _client.PostAsJsonAsync($"/api/v1/attempts/{attemptId}/answers", request);
        first.StatusCode.ShouldBe(HttpStatusCode.OK, await first.Content.ReadAsStringAsync());

        var second = await _client.PostAsJsonAsync($"/api/v1/attempts/{attemptId}/answers", request);
        second.StatusCode.ShouldBe(HttpStatusCode.OK, await second.Content.ReadAsStringAsync());

        var body = await second.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("acceptedClientSeq").GetInt32().ShouldBe(5);

        // 答案仍然只有一条，修订序号没有被重复推进。
        var answers = await LoadAnswersAsync(attemptId);
        answers.Count.ShouldBe(1);
        answers[0].Revision.ShouldBe(1);
    }

    [Fact]
    public async Task 更大的序列号会覆盖答案并推进修订号()
    {
        var attemptId = await StartAttemptAsync();

        await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/answers",
            new
            {
                clientSeq = 1,
                items = new[]
                {
                    new { questionId = _questionId, payload = new { selectedOptionKeys = new[] { "A" } } },
                },
            });

        await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/answers",
            new
            {
                clientSeq = 2,
                items = new[]
                {
                    new { questionId = _questionId, payload = new { selectedOptionKeys = new[] { "B" } } },
                },
            });

        var answers = await LoadAnswersAsync(attemptId);
        answers.Count.ShouldBe(1);
        answers[0].Revision.ShouldBe(2);
    }

    [Fact]
    public async Task 超过截止时间返回409()
    {
        var attemptId = await StartAttemptAsync();

        await ForceDeadlineAsync(attemptId, DateTimeOffset.UtcNow.AddMinutes(-1));

        var save = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/answers",
            new
            {
                clientSeq = 1,
                items = new[]
                {
                    new { questionId = _questionId, payload = new { selectedOptionKeys = new[] { "A" } } },
                },
            });

        save.StatusCode.ShouldBe(HttpStatusCode.Conflict);

        var problem = await save.Content.ReadFromJsonAsync<JsonElement>();
        problem.GetProperty("errorCode").GetInt32().ShouldBe(25002);
    }

    [Fact]
    public async Task 单批超过上限被拒()
    {
        var attemptId = await StartAttemptAsync();

        var items = Enumerable.Range(0, 51)
            .Select(_ => new { questionId = _questionId, payload = new { selectedOptionKeys = new[] { "A" } } })
            .ToArray();

        var save = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/answers",
            new { clientSeq = 1, items });

        save.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task 卷面外的题目被拒并给出原因()
    {
        var attemptId = await StartAttemptAsync();

        var save = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/answers",
            new
            {
                clientSeq = 1,
                items = new[]
                {
                    new { questionId = 999999L, payload = new { selectedOptionKeys = new[] { "A" } } },
                },
            });

        save.StatusCode.ShouldBe(HttpStatusCode.OK, await save.Content.ReadAsStringAsync());

        var body = await save.Content.ReadFromJsonAsync<JsonElement>();
        var rejected = body.GetProperty("rejected");
        rejected.GetArrayLength().ShouldBe(1);
        rejected[0].GetProperty("questionId").GetInt64().ShouldBe(999999L);
        rejected[0].GetProperty("reason").GetString()!.ShouldContain("卷面");
    }

    [Fact]
    public async Task 单选传两个选项被拒()
    {
        var attemptId = await StartAttemptAsync();

        var save = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/answers",
            new
            {
                clientSeq = 1,
                items = new[]
                {
                    new { questionId = _questionId, payload = new { selectedOptionKeys = new[] { "A", "B" } } },
                },
            });

        save.StatusCode.ShouldBe(HttpStatusCode.OK, await save.Content.ReadAsStringAsync());

        var body = await save.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("rejected").GetArrayLength().ShouldBe(1);
        body.GetProperty("rejected")[0].GetProperty("reason").GetString()!.ShouldContain("只能选一个");
    }

    [Fact]
    public async Task 保存答案会留下修订流水()
    {
        var attemptId = await StartAttemptAsync();

        await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/answers",
            new
            {
                clientSeq = 7,
                items = new[]
                {
                    new { questionId = _questionId, payload = new { selectedOptionKeys = new[] { "A" } } },
                },
            });

        var revisions = await LoadRevisionsAsync(attemptId);
        revisions.Count.ShouldBe(1);
        revisions[0].ClientSeq.ShouldBe(7);
        revisions[0].Revision.ShouldBe(1);
    }

    [Fact]
    public async Task 重复提交不会多写修订流水()
    {
        var attemptId = await StartAttemptAsync();

        var request = new
        {
            clientSeq = 3,
            items = new[]
            {
                new { questionId = _questionId, payload = new { selectedOptionKeys = new[] { "A" } } },
            },
        };

        await _client.PostAsJsonAsync($"/api/v1/attempts/{attemptId}/answers", request);
        await _client.PostAsJsonAsync($"/api/v1/attempts/{attemptId}/answers", request);

        var revisions = await LoadRevisionsAsync(attemptId);
        revisions.Count.ShouldBe(1);
    }

    private async Task<IReadOnlyList<AnswerRevisionRow>> LoadRevisionsAsync(long attemptId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        return await db.Set<AnswerRevision>()
            .AsNoTracking()
            .Where(r => r.AttemptId == attemptId)
            .Select(r => new AnswerRevisionRow(r.Id, r.QuestionId, r.ClientSeq, r.Revision))
            .ToListAsync();
    }

    private sealed record AnswerRevisionRow(long Id, long QuestionId, int ClientSeq, int Revision);

    private async Task<long> StartAttemptAsync()
    {
        await LoginAsync(TeacherUsername, TeacherPassword);
        var sessionId = await CreateSessionAsync();

        await LoginAsync(StudentUsername, StudentPassword);

        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { examSessionId = sessionId });
        start.StatusCode.ShouldBe(HttpStatusCode.OK, await start.Content.ReadAsStringAsync());

        var body = await start.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("attemptId").GetInt64();
    }

    private async Task<IReadOnlyList<AnswerRow>> LoadAnswersAsync(long attemptId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        return await db.Set<Answer>()
            .AsNoTracking()
            .Where(a => a.AttemptId == attemptId)
            .Select(a => new AnswerRow(a.Id, a.QuestionId, a.Revision, a.ClientSeq))
            .ToListAsync();
    }

    private async Task ForceDeadlineAsync(long attemptId, DateTimeOffset deadline)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE delivery.attempt SET deadline_at = {deadline} WHERE id = {attemptId}");
    }

    private sealed record AnswerRow(long Id, long QuestionId, int Revision, int ClientSeq);

    private async Task<long> CreateSessionAsync()
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

        var paperBody = await create.Content.ReadFromJsonAsync<JsonElement>();
        var paperId = paperBody.GetProperty("paper").GetProperty("id").GetInt64();

        var add = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/items",
            new { questionId = _questionId, score = 10m });
        add.StatusCode.ShouldBe(HttpStatusCode.OK, await add.Content.ReadAsStringAsync());

        var publishPaper = await _client.PostAsync($"/api/v1/papers/{paperId}/publish", null);
        publishPaper.StatusCode.ShouldBe(HttpStatusCode.OK, await publishPaper.Content.ReadAsStringAsync());

        var session = await _client.PostAsJsonAsync(
            "/api/v1/exam-sessions",
            new
            {
                paperId,
                name = "计算机网络期中考试",
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
        var response = await _client.PostAsJsonAsync(
            "/api/v1/auth/login",
            new { username, password });

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

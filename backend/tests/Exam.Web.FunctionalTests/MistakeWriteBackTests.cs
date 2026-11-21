using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Exam.Application.Messaging;
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
/// 错题回流。
/// <para>
/// 成绩定分就回流：客观题判错、主观题部分得分，都进错题本。
/// </para>
/// </summary>
public sealed class MistakeWriteBackTests : IAsyncLifetime
{
    private const string TeacherUsername = "reflowteacher1";
    private const string TeacherPassword = "Passw0rd!";
    private const string StudentUsername = "reflowstudent1";
    private const string StudentPassword = "Passw0rd!";

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    private ExamWebFactory _factory = null!;
    private HttpClient _client = null!;
    private long _singleQuestionId;
    private long _shortQuestionId;
    private long _sessionId;
    private long _studentId;

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
            "reflow_teacher",
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

        var studentRoleId = await SeedRoleAsync(db, "reflow_student", PermissionCatalog.AttemptTake, PermissionCatalog.AttemptReadOwn);
        await SeedUserAsync(db, StudentUsername, StudentPassword, studentRoleId);

        _singleQuestionId = await SeedSingleQuestionAsync(db, "Q-RFL-001");
        _shortQuestionId = await SeedShortQuestionAsync(db, "Q-RFL-002");

        _sessionId = await CreateSessionAsync();

        await LoginAsync(StudentUsername, StudentPassword);
        _studentId = await CurrentUserIdAsync();
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 客观题答错自动进错题本()
    {
        var attemptId = await StartAttemptAsync();

        await SaveAnswerAsync(attemptId, _singleQuestionId, new { selectedOptionKeys = new[] { "B" } });
        await SubmitAsync(attemptId);

        // 交卷即定分：事件已经进了 Outbox。
        (await PendingMessageCountAsync()).ShouldBeGreaterThanOrEqualTo(1);

        await DispatchAsync();

        var mistakes = await MistakeRowsAsync();
        mistakes.Count.ShouldBe(1);
        mistakes[0].QuestionId.ShouldBe(_singleQuestionId);
        mistakes[0].WrongCount.ShouldBe(1);
        mistakes[0].Reason.ShouldBe(MistakeReason.SingleWrong);
        mistakes[0].SourceType.ShouldBe(MistakeSourceType.Exam);
        mistakes[0].SourceAttemptId.ShouldBe(attemptId);
    }

    [Fact]
    public async Task 主观题部分得分也回流()
    {
        var attemptId = await StartAttemptAsync();

        // 客观题答对，主观题只答对一个要点。
        await SaveAnswerAsync(attemptId, _singleQuestionId, new { selectedOptionKeys = new[] { "A" } });
        await SaveAnswerAsync(attemptId, _shortQuestionId, new { text = "TCP 三次握手可以建立连接" });
        await SubmitAsync(attemptId);

        await DispatchAsync();

        // 主观题还没定分，不回流。
        (await MistakeRowsAsync()).ShouldBeEmpty();

        // 阅卷人给 5 分：拿了一半分，没满分——也算错题。
        await LoginAsync(TeacherUsername, TeacherPassword);
        var taskId = await LatestTaskIdAsync();
        var grade = await _client.PostAsJsonAsync(
            $"/api/v1/review-tasks/{taskId}/grade",
            new { score = 5m, comment = "要点只覆盖一半" });
        grade.StatusCode.ShouldBe(HttpStatusCode.OK, await grade.Content.ReadAsStringAsync());

        await DispatchAsync();

        var mistakes = await MistakeRowsAsync();
        mistakes.Count.ShouldBe(1);
        mistakes[0].QuestionId.ShouldBe(_shortQuestionId);
        mistakes[0].Reason.ShouldBe(MistakeReason.ShortKeypointsMissed);
        mistakes[0].WrongCount.ShouldBe(1);
    }

    [Fact]
    public async Task 未作答的题进错题本()
    {
        var attemptId = await StartAttemptAsync();

        // 客观题没作答：零分，也是错题。
        await SubmitAsync(attemptId);

        await DispatchAsync();

        var mistakes = await MistakeRowsAsync();
        mistakes.Count.ShouldBe(1);
        mistakes[0].QuestionId.ShouldBe(_singleQuestionId);
        mistakes[0].Reason.ShouldBe(MistakeReason.Unanswered);
    }

    [Fact]
    public async Task 主观题满分定分后不进错题本()
    {
        var attemptId = await StartAttemptAsync();

        await SaveAnswerAsync(attemptId, _singleQuestionId, new { selectedOptionKeys = new[] { "A" } });
        await SaveAnswerAsync(attemptId, _shortQuestionId, new { text = "TCP 三次握手可以建立连接" });
        await SubmitAsync(attemptId);

        await DispatchAsync();
        (await MistakeRowsAsync()).ShouldBeEmpty();

        // 阅卷人给了满分：不是错题。
        await LoginAsync(TeacherUsername, TeacherPassword);
        var taskId = await LatestTaskIdAsync();
        var grade = await _client.PostAsJsonAsync(
            $"/api/v1/review-tasks/{taskId}/grade",
            new { score = 10m, comment = "要点全覆盖" });
        grade.StatusCode.ShouldBe(HttpStatusCode.OK, await grade.Content.ReadAsStringAsync());

        await DispatchAsync();

        (await MistakeRowsAsync()).ShouldBeEmpty();
    }

    [Fact]
    public async Task 同一次作答里改分不累计次数()
    {
        var attemptId = await StartAttemptAsync();

        await SaveAnswerAsync(attemptId, _singleQuestionId, new { selectedOptionKeys = new[] { "A" } });
        await SaveAnswerAsync(attemptId, _shortQuestionId, new { text = "TCP 三次握手可以建立连接" });
        await SubmitAsync(attemptId);

        await LoginAsync(TeacherUsername, TeacherPassword);
        var taskId = await LatestTaskIdAsync();

        await _client.PostAsJsonAsync(
            $"/api/v1/review-tasks/{taskId}/grade",
            new { score = 5m, comment = "要点只覆盖一半" });

        await DispatchAsync();
        (await MistakeRowsAsync())[0].WrongCount.ShouldBe(1);

        // 复核后改分：还是同一次作答，不该又算错一次。
        await _client.PostAsJsonAsync(
            $"/api/v1/review-tasks/{taskId}/grade",
            new { score = 3m, comment = "复核后调整" });

        await DispatchAsync();

        var mistakes = await MistakeRowsAsync();
        mistakes.Count.ShouldBe(1);
        mistakes[0].WrongCount.ShouldBe(1);
    }

    [Fact]
    public async Task 又错一次累计次数()
    {
        var firstAttempt = await StartAttemptAsync();
        await SaveAnswerAsync(firstAttempt, _singleQuestionId, new { selectedOptionKeys = new[] { "B" } });
        await SubmitAsync(firstAttempt);

        await DispatchAsync();
        (await MistakeRowsAsync())[0].WrongCount.ShouldBe(1);

        // 重考又错：次数累计。
        var secondAttempt = await StartAttemptAsync();
        await SaveAnswerAsync(secondAttempt, _singleQuestionId, new { selectedOptionKeys = new[] { "B" } });
        await SubmitAsync(secondAttempt);

        await DispatchAsync();

        var mistakes = await MistakeRowsAsync();
        mistakes.Count.ShouldBe(1);
        mistakes[0].WrongCount.ShouldBe(2);
        mistakes[0].SourceAttemptId.ShouldBe(secondAttempt);
    }

    [Fact]
    public async Task 后来答对了移出错题本()
    {
        var firstAttempt = await StartAttemptAsync();
        await SaveAnswerAsync(firstAttempt, _singleQuestionId, new { selectedOptionKeys = new[] { "B" } });
        await SubmitAsync(firstAttempt);

        await DispatchAsync();
        (await MistakeRowsAsync()).Count.ShouldBe(1);

        // 后来答对了：不再是错题。
        var secondAttempt = await StartAttemptAsync();
        await SaveAnswerAsync(secondAttempt, _singleQuestionId, new { selectedOptionKeys = new[] { "A" } });
        await SubmitAsync(secondAttempt);

        await DispatchAsync();

        // 系统级设置的默认口径是「移出错题本」：错题本里看不到它了。
        (await MistakeRowsAsync()).ShouldBeEmpty();

        // 数据没硬删（ADR-019）：记录还在，只是被标记成移出了。
        var raw = await RawMistakeRowsAsync();
        raw.Count.ShouldBe(1);
        raw[0].ResolvedAt.ShouldNotBeNull();
        raw[0].DeletedAt.ShouldNotBeNull();
    }

    [Fact]
    public async Task 移出错题本之后又做错次数接着累计()
    {
        var firstAttempt = await StartAttemptAsync();
        await SaveAnswerAsync(firstAttempt, _singleQuestionId, new { selectedOptionKeys = new[] { "B" } });
        await SubmitAsync(firstAttempt);

        await DispatchAsync();
        (await MistakeRowsAsync())[0].WrongCount.ShouldBe(1);

        // 答对了：移出错题本。
        var secondAttempt = await StartAttemptAsync();
        await SaveAnswerAsync(secondAttempt, _singleQuestionId, new { selectedOptionKeys = new[] { "A" } });
        await SubmitAsync(secondAttempt);

        await DispatchAsync();
        (await MistakeRowsAsync()).ShouldBeEmpty();

        // 又做错了：记录回到错题本，次数接着数，不从头来。
        var thirdAttempt = await StartAttemptAsync();
        await SaveAnswerAsync(thirdAttempt, _singleQuestionId, new { selectedOptionKeys = new[] { "B" } });
        await SubmitAsync(thirdAttempt);

        await DispatchAsync();

        var mistakes = await MistakeRowsAsync();
        mistakes.Count.ShouldBe(1);
        mistakes[0].WrongCount.ShouldBe(2);
        mistakes[0].SourceAttemptId.ShouldBe(thirdAttempt);
    }

    private async Task<int> PendingMessageCountAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.OutboxMessages.CountAsync(m => m.DispatchedAt == null);
    }

    private async Task<List<MistakeRow>> MistakeRowsAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        return await db.Mistakes
            .AsNoTracking()
            .Where(m => m.UserId == _studentId)
            .OrderBy(m => m.Id)
            .Select(m => new MistakeRow(
                m.QuestionId,
                m.WrongCount,
                m.Reason,
                m.SourceType,
                m.SourceAttemptId,
                m.ResolvedAt))
            .ToListAsync();
    }

    /// <summary>绕过软删除过滤器查错题行——「移出错题本」之后记录还在。</summary>
    private async Task<List<MistakeRow>> RawMistakeRowsAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        return await db.Mistakes
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(m => m.UserId == _studentId)
            .OrderBy(m => m.Id)
            .Select(m => new MistakeRow(
                m.QuestionId,
                m.WrongCount,
                m.Reason,
                m.SourceType,
                m.SourceAttemptId,
                m.ResolvedAt,
                m.DeletedAt))
            .ToListAsync();
    }

    /// <summary>派发 Outbox 里的领域事件（Worker 在生产里干这件事）。</summary>
    private async Task<int> DispatchAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var dispatcher = scope.ServiceProvider.GetRequiredService<IDomainEventDispatcher>();
        return await dispatcher.DispatchPendingAsync();
    }

    private async Task SaveAnswerAsync(long attemptId, long questionId, object payload)
    {
        var seq = _clientSeqByAttempt.TryGetValue(attemptId, out var current) ? current + 1 : 1;
        _clientSeqByAttempt[attemptId] = seq;

        var save = await _client.PostAsJsonAsync(
            $"/api/v1/attempts/{attemptId}/answers",
            new { clientSeq = seq, items = new[] { new { questionId, payload } } });

        save.StatusCode.ShouldBe(HttpStatusCode.OK, await save.Content.ReadAsStringAsync());
    }

    private readonly Dictionary<long, int> _clientSeqByAttempt = new();

    private async Task SubmitAsync(long attemptId)
    {
        var submit = await _client.PostAsJsonAsync($"/api/v1/attempts/{attemptId}/submit", new { reason = "manual" });
        submit.StatusCode.ShouldBe(HttpStatusCode.OK, await submit.Content.ReadAsStringAsync());
    }

    private async Task<long> CurrentUserIdAsync()
    {
        var me = await _client.GetAsync("/api/v1/auth/me");
        me.StatusCode.ShouldBe(HttpStatusCode.OK, await me.Content.ReadAsStringAsync());

        var body = await me.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("id").GetInt64();
    }

    private async Task<long> StartAttemptAsync()
    {
        await LoginAsync(StudentUsername, StudentPassword);

        var start = await _client.PostAsJsonAsync("/api/v1/attempts", new { examSessionId = _sessionId });
        start.StatusCode.ShouldBe(HttpStatusCode.OK, await start.Content.ReadAsStringAsync());

        var body = await start.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("attemptId").GetInt64();
    }

    private async Task<long> LatestTaskIdAsync()
    {
        await LoginAsync(TeacherUsername, TeacherPassword);

        var list = await _client.GetAsync("/api/v1/review-tasks");
        list.StatusCode.ShouldBe(HttpStatusCode.OK, await list.Content.ReadAsStringAsync());

        var body = await list.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray().ToList();
        return items[^1].GetProperty("id").GetInt64();
    }

    private async Task<long> CreateSessionAsync()
    {
        await LoginAsync(TeacherUsername, TeacherPassword);

        var create = await _client.PostAsJsonAsync(
            "/api/v1/papers",
            new
            {
                kind = "exam",
                name = "错题回流测试考试",
                targetTotalScore = 20,
                durationMinutes = 15,
                allowRetake = true,
            });
        create.StatusCode.ShouldBe(HttpStatusCode.OK, await create.Content.ReadAsStringAsync());

        var paperBody = await create.Content.ReadFromJsonAsync<JsonElement>();
        var paperId = paperBody.GetProperty("paper").GetProperty("id").GetInt64();

        foreach (var questionId in new[] { _singleQuestionId, _shortQuestionId })
        {
            var add = await _client.PostAsJsonAsync(
                $"/api/v1/papers/{paperId}/items",
                new { questionId, score = 10m });
            add.StatusCode.ShouldBe(HttpStatusCode.OK, await add.Content.ReadAsStringAsync());
        }

        var publishPaper = await _client.PostAsJsonAsync(
            $"/api/v1/papers/{paperId}/publish",
            new { warningOverrideReason = "本次含主观题，用于验证错题回流" });
        publishPaper.StatusCode.ShouldBe(HttpStatusCode.OK, await publishPaper.Content.ReadAsStringAsync());

        var session = await _client.PostAsJsonAsync(
            "/api/v1/exam-sessions",
            new
            {
                paperId,
                name = "错题回流测试考试",
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

    private static async Task<long> SeedSingleQuestionAsync(AppDbContext db, string code)
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

    private static async Task<long> SeedShortQuestionAsync(AppDbContext db, string code)
    {
        var now = DateTimeOffset.UtcNow;
        var question = Question.CreateDraft(code, QuestionType.Short, "题干", Score.Question(10), 1, now);
        question.AddKeypoint(QuestionKeypoint.Create("三次握手", ["三次", "握手"], 0), now);
        question.AddKeypoint(QuestionKeypoint.Create("四次挥手", ["四次", "挥手"], 1), now);

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

    /// <summary>错题行（只取断言要用的字段）。</summary>
    private sealed record MistakeRow(
        long QuestionId,
        int WrongCount,
        MistakeReason Reason,
        MistakeSourceType SourceType,
        long? SourceAttemptId,
        DateTimeOffset? ResolvedAt,
        DateTimeOffset? DeletedAt = null);
}

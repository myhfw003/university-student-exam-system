using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Exam.Application.Common.Security;
using Exam.Domain.Identity;
using Exam.Domain.SharedKernel.Abstractions;
using Exam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;
using Testcontainers.PostgreSql;

namespace Exam.Web.FunctionalTests;

/// <summary>
/// 限流分档：登录按 IP + 按账号，保存答案与切屏事件按用户，其余写端点按用户，
/// 读端点按用户（登录）或来源 IP（未登录）。阈值见 docs/design/05-api.md §1.5。
/// <para>
/// 健康检查与指标不参与限流——探针被限流，容器会被判成不健康。
/// </para>
/// </summary>
public sealed class RateLimitTests : IAsyncLifetime
{
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
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 登录超过每IP阈值返回429()
    {
        await using var factory = new ExamWebFactory(
            _postgres.GetConnectionString(),
            configuration: new Dictionary<string, string?>
            {
                ["RateLimiting:LoginPerIpPerMinute"] = "3",
            });

        using var client = factory.CreateClient();
        client.BaseAddress = new Uri("http://localhost");

        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 6; i++)
        {
            var response = await client.PostAsJsonAsync(
                "/api/v1/auth/login",
                new { username = $"iplimit{i:D2}", password = "Pass123456" });
            statuses.Add(response.StatusCode);
        }

        statuses.ShouldContain(HttpStatusCode.TooManyRequests, $"实际状态：{string.Join(",", statuses)}");
    }

    [Fact]
    public async Task 登录超过每账号阈值返回429()
    {
        await using var factory = new ExamWebFactory(
            _postgres.GetConnectionString(),
            configuration: new Dictionary<string, string?>
            {
                // IP 维度放到足够高：这一条要验的是账号维度单独生效。
                ["RateLimiting:LoginPerIpPerMinute"] = "100",
                ["RateLimiting:LoginPerAccountPerMinute"] = "2",
            });

        using var client = factory.CreateClient();
        client.BaseAddress = new Uri("http://localhost");

        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 5; i++)
        {
            var response = await client.PostAsJsonAsync(
                "/api/v1/auth/login",
                new { username = "SameAccount01", password = "WrongPass123" });
            statuses.Add(response.StatusCode);
        }

        statuses.Take(2).ShouldAllBe(status => status != HttpStatusCode.TooManyRequests);
        statuses.ShouldContain(HttpStatusCode.TooManyRequests, $"实际状态：{string.Join(",", statuses)}");
    }

    [Fact]
    public async Task 登录账号大小写不同算同一个账号()
    {
        await using var factory = new ExamWebFactory(
            _postgres.GetConnectionString(),
            configuration: new Dictionary<string, string?>
            {
                ["RateLimiting:LoginPerIpPerMinute"] = "100",
                ["RateLimiting:LoginPerAccountPerMinute"] = "2",
            });

        using var client = factory.CreateClient();
        client.BaseAddress = new Uri("http://localhost");

        // 查库是按小写比对的：换个大小写就是同一个账号，
        // 换大小写不能绕过每账号的额度。
        await client.PostAsJsonAsync("/api/v1/auth/login", new { username = "CaseSame01", password = "WrongPass123" });
        await client.PostAsJsonAsync("/api/v1/auth/login", new { username = "casesame01", password = "WrongPass123" });

        var response = await client.PostAsJsonAsync(
            "/api/v1/auth/login",
            new { username = "CASESAME01", password = "WrongPass123" });

        response.StatusCode.ShouldBe(HttpStatusCode.TooManyRequests);
    }

    [Fact]
    public async Task 保存答案走自己的档位()
    {
        await using var factory = new ExamWebFactory(
            _postgres.GetConnectionString(),
            configuration: new Dictionary<string, string?>
            {
                ["RateLimiting:AnswersPerUserPerMinute"] = "1",
                // 写端点档位放到很高：保存答案不归它管。
                ["RateLimiting:WritesPerUserPerMinute"] = "100",
            });

        using var client = factory.CreateClient();
        client.BaseAddress = new Uri("http://localhost");

        var token = await LoginAsync(factory, client, "answerslim01");

        var first = await PostAnswersAsync(client, token, attemptId: 1);
        first.StatusCode.ShouldNotBe(HttpStatusCode.TooManyRequests);

        var second = await PostAnswersAsync(client, token, attemptId: 1);
        second.StatusCode.ShouldBe(HttpStatusCode.TooManyRequests);
    }

    [Fact]
    public async Task 写端点超过每用户阈值返回429()
    {
        await using var factory = new ExamWebFactory(
            _postgres.GetConnectionString(),
            configuration: new Dictionary<string, string?>
            {
                ["RateLimiting:WritesPerUserPerMinute"] = "2",
            });

        using var client = factory.CreateClient();
        client.BaseAddress = new Uri("http://localhost");

        var token = await LoginAsync(factory, client, "writeslim01");

        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 4; i++)
        {
            var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/attempts")
            {
                Content = JsonContent.Create(new { examSessionId = 0 }),
            };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

            var response = await client.SendAsync(request);
            statuses.Add(response.StatusCode);
        }

        statuses.Take(2).ShouldAllBe(status => status != HttpStatusCode.TooManyRequests);
        statuses.ShouldContain(HttpStatusCode.TooManyRequests, $"实际状态：{string.Join(",", statuses)}");
    }

    [Fact]
    public async Task 未登录读端点超过阈值返回429()
    {
        await using var factory = new ExamWebFactory(
            _postgres.GetConnectionString(),
            configuration: new Dictionary<string, string?>
            {
                ["RateLimiting:ReadsPerMinute"] = "2",
            });

        using var client = factory.CreateClient();
        client.BaseAddress = new Uri("http://localhost");

        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 5; i++)
        {
            var response = await client.GetAsync("/api/v1/auth/me");
            statuses.Add(response.StatusCode);
        }

        statuses.ShouldContain(HttpStatusCode.TooManyRequests, $"实际状态：{string.Join(",", statuses)}");
    }

    [Fact]
    public async Task 超限响应带错误码与RetryAfter()
    {
        await using var factory = new ExamWebFactory(
            _postgres.GetConnectionString(),
            configuration: new Dictionary<string, string?>
            {
                ["RateLimiting:ReadsPerMinute"] = "1",
            });

        using var client = factory.CreateClient();
        client.BaseAddress = new Uri("http://localhost");

        await client.GetAsync("/api/v1/auth/me");
        var response = await client.GetAsync("/api/v1/auth/me");

        response.StatusCode.ShouldBe(HttpStatusCode.TooManyRequests);
        response.Headers.RetryAfter.ShouldNotBeNull();

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("errorCode").GetInt32().ShouldBe(20007);
        body.GetProperty("status").GetInt32().ShouldBe(429);
    }

    [Fact]
    public async Task 健康检查不受限流影响()
    {
        await using var factory = new ExamWebFactory(
            _postgres.GetConnectionString(),
            configuration: new Dictionary<string, string?>
            {
                ["RateLimiting:ReadsPerMinute"] = "2",
            });

        using var client = factory.CreateClient();
        client.BaseAddress = new Uri("http://localhost");

        for (var i = 0; i < 8; i++)
        {
            var response = await client.GetAsync("/health/live");
            response.StatusCode.ShouldBe(HttpStatusCode.OK);
        }
    }

    private static async Task<HttpResponseMessage> PostAnswersAsync(HttpClient client, string token, long attemptId)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/attempts/{attemptId}/answers")
        {
            Content = JsonContent.Create(new
            {
                clientSeq = 1,
                items = new[]
                {
                    new { questionId = 1, payload = new { selectedOptionKeys = new[] { "A" } } },
                },
            }),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        return await client.SendAsync(request);
    }

    /// <summary>建一个普通用户并登录，拿到访问令牌。</summary>
    private static async Task<string> LoginAsync(ExamWebFactory factory, HttpClient client, string username)
    {
        const string password = "Pass123456";

        using (var scope = factory.Services.CreateScope())
        {
            var verifier = scope.ServiceProvider.GetRequiredService<IPasswordVerifier>();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            db.Users.Add(User.Register(username, "限流测试用户", verifier.Hash(password), DateTimeOffset.UtcNow));
            await db.SaveChangesAsync();
        }

        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { username, password });
        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("accessToken").GetString()!;
    }
}

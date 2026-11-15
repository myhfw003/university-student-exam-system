using System.Net;
using Shouldly;
using Testcontainers.PostgreSql;

namespace Exam.Web.FunctionalTests;

/// <summary>
/// 限流。
/// <para>
/// 超过阈值的请求返回 429；健康检查与指标不参与限流——
/// 探针被限流，容器会被判成不健康。
/// </para>
/// </summary>
public sealed class RateLimitTests : IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("exam")
        .WithUsername("exam_owner")
        .WithPassword("exam_owner_password")
        .Build();

    public async Task InitializeAsync() => await _postgres.StartAsync();

    public async Task DisposeAsync() => await _postgres.DisposeAsync();

    [Fact]
    public async Task 超过限流返回429()
    {
        await using var factory = new ExamWebFactory(
            _postgres.GetConnectionString(),
            globalPerMinute: 5);

        using var client = factory.CreateClient();
        client.BaseAddress = new Uri("http://localhost");

        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 12; i++)
        {
            var response = await client.GetAsync("/api/v1/auth/me");
            statuses.Add(response.StatusCode);
        }

        statuses.ShouldContain(HttpStatusCode.TooManyRequests, $"实际状态：{string.Join(",", statuses)}");
    }

    [Fact]
    public async Task 健康检查不受限流影响()
    {
        await using var factory = new ExamWebFactory(
            _postgres.GetConnectionString(),
            globalPerMinute: 2);

        using var client = factory.CreateClient();
        client.BaseAddress = new Uri("http://localhost");

        for (var i = 0; i < 8; i++)
        {
            var response = await client.GetAsync("/health/live");
            response.StatusCode.ShouldBe(HttpStatusCode.OK);
        }
    }
}

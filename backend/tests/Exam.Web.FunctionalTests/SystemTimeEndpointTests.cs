using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Shouldly;
using Testcontainers.PostgreSql;

namespace Exam.Web.FunctionalTests;

/// <summary>服务端时钟同步接口。考试计时以服务端时间为准。</summary>
public sealed class SystemTimeEndpointTests : IAsyncLifetime
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
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    [Fact]
    public async Task 匿名也能取到服务端时间()
    {
        var response = await _client.GetAsync("/api/v1/system/time");

        response.StatusCode.ShouldBe(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var serverTime = body.GetProperty("serverTime").GetDateTimeOffset();

        // 服务端时间应当接近本机时间（同一台机器上跑的容器）。
        Math.Abs((serverTime - DateTimeOffset.UtcNow).TotalSeconds).ShouldBeLessThan(60);

        body.GetProperty("epochMilliseconds").GetInt64().ShouldBeGreaterThan(0);
        body.GetProperty("monotonicTime").GetInt64().ShouldBeGreaterThan(0);
    }

    [Fact]
    public async Task 多次采样返回的时间单调递增()
    {
        var first = await _client.GetAsync("/api/v1/system/time");
        var firstBody = await first.Content.ReadFromJsonAsync<JsonElement>();

        await Task.Delay(20);

        var second = await _client.GetAsync("/api/v1/system/time");
        var secondBody = await second.Content.ReadFromJsonAsync<JsonElement>();

        secondBody.GetProperty("monotonicTime").GetInt64()
            .ShouldBeGreaterThan(firstBody.GetProperty("monotonicTime").GetInt64());
    }
}

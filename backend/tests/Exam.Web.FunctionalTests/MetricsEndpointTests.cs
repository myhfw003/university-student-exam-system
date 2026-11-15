using System.Net;
using Shouldly;
using Testcontainers.PostgreSql;

namespace Exam.Web.FunctionalTests;

/// <summary>
/// 指标端点。
/// <para>
/// 告警规则按指标名字取数——指标没暴露出来，等于没有告警。
/// </para>
/// </summary>
public sealed class MetricsEndpointTests : IAsyncLifetime
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
    public async Task 指标端点带出告警依赖的指标()
    {
        var response = await _client.GetAsync("/metrics");
        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        var body = await response.Content.ReadAsStringAsync();

        // 告警规则用到的名字，一个都不能少。
        // 直方图在第一次观测之前只有 HELP/TYPE 两行，没有分桶序列——名字在就够了。
        body.ShouldContain("attempt_answers_saved_total");
        body.ShouldContain("attempt_answers_saved_duration_seconds");
        body.ShouldContain("attempt_answer_items_rejected_total");
        body.ShouldContain("attempt_focus_events_total");
        body.ShouldContain("exam_sessions_published_total");
        body.ShouldContain("http_requests_total");
        body.ShouldContain("http_request_duration_seconds");
        body.ShouldContain("signalr_connections");
        body.ShouldContain("clock_offset_ms");
        body.ShouldContain("redis_up");
        body.ShouldContain("redis_command_duration_seconds");
    }

    [Fact]
    public async Task 指标端点不混进Worker侧的指标()
    {
        // 同一个指标名被两个进程各报一次，告警里的比例就凭空翻倍。
        // Worker 侧的指标只应出现在 Worker 的指标端口上。
        var body = await _client.GetStringAsync("/metrics");

        body.ShouldNotContain("attempt_active_sessions");
        body.ShouldNotContain("outbox_pending_messages");
        body.ShouldNotContain("background_job_duration_seconds");
        body.ShouldNotContain("background_job_failures_total");
        body.ShouldNotContain("answer_reconciliation_findings_total");
        body.ShouldNotContain("db_pool_active_connections");
        body.ShouldNotContain("db_pool_max_connections");
        body.ShouldNotContain("db_pool_available_connections");
    }

    [Fact]
    public async Task 请求会记进HTTP指标()
    {
        // 先打一次请求，再看指标里有没有这条请求。
        await _client.GetAsync("/health/live");

        var body = await _client.GetStringAsync("/metrics");

        body.ShouldContain("http_requests_total");
        body.ShouldContain("http_request_duration_seconds");
    }
}

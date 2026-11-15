using System.Text;
using Exam.Infrastructure.Observability;
using Prometheus;
using Shouldly;

namespace Exam.Infrastructure.IntegrationTests.Observability;

/// <summary>
/// 指标注册表。
/// <para>
/// 两套指标必须互不重叠：同一个指标名被两个进程各报一次，
/// 告警里的比例就凭空翻倍。各自用独立注册表来断言。
/// </para>
/// </summary>
public sealed class MetricRegistryTests
{
    [Fact]
    public async Task API进程只报API侧的指标()
    {
        var registry = Metrics.NewCustomRegistry();
        var metrics = new ExamMetrics(Metrics.WithCustomRegistry(registry));

        metrics.RecordAnswerSave("saved", 0.2);
        metrics.RecordAnswerItemsRejected(3);
        metrics.RecordFocusEvent("blur");
        metrics.RecordExamSessionPublished();
        metrics.RecordHttpRequest("GET", "api/v1/system/time", 200, 0.01);
        metrics.SignalRConnected();
        metrics.SetClockOffsetMs(12);
        metrics.RecordRedisCommand("ping", 0.002);
        metrics.SetRedisUp(true);

        var text = await DumpAsync(registry);

        text.ShouldContain("attempt_answers_saved_total{result=\"saved\"} 1");
        text.ShouldContain("attempt_answer_items_rejected_total 3");
        text.ShouldContain("attempt_focus_events_total{type=\"blur\"} 1");
        text.ShouldContain("exam_sessions_published_total 1");
        text.ShouldContain("http_requests_total{method=\"GET\",route=\"api/v1/system/time\",status=\"200\"} 1");
        text.ShouldContain("http_request_duration_seconds_count{method=\"GET\",route=\"api/v1/system/time\"} 1");
        text.ShouldContain("signalr_connections 1");
        text.ShouldContain("clock_offset_ms 12");
        text.ShouldContain("redis_up 1");
        text.ShouldContain("redis_command_duration_seconds_count{op=\"ping\"} 1");

        // Worker 侧的指标一个都不该出现在 API 进程里。
        text.ShouldNotContain("attempt_active_sessions");
        text.ShouldNotContain("outbox_pending_messages");
        text.ShouldNotContain("background_job_duration_seconds");
        text.ShouldNotContain("answer_reconciliation_findings_total");
        text.ShouldNotContain("db_pool_active_connections");
    }

    [Fact]
    public async Task Worker进程只报Worker侧的指标()
    {
        var registry = Metrics.NewCustomRegistry();
        var metrics = new WorkerMetrics(Metrics.WithCustomRegistry(registry));

        metrics.RecordBackgroundJob("outbox_dispatch", 0.5, failed: true);
        metrics.SetOutboxPending(12);
        metrics.RecordReconciliationFindings(2);
        metrics.SetActiveSessions(42, 7);
        metrics.SetDatabaseConnections(30, 200);

        var text = await DumpAsync(registry);

        text.ShouldContain("background_job_duration_seconds_count{job=\"outbox_dispatch\"} 1");
        text.ShouldContain("background_job_failures_total{job=\"outbox_dispatch\"} 1");
        text.ShouldContain("outbox_pending_messages 12");
        text.ShouldContain("answer_reconciliation_findings_total 2");
        text.ShouldContain("attempt_active_sessions{examSessionId=\"42\"} 7");
        text.ShouldContain("db_pool_active_connections 30");
        text.ShouldContain("db_pool_max_connections 200");
        text.ShouldContain("db_pool_available_connections 170");

        // API 侧的指标一个都不该出现在 Worker 进程里。
        text.ShouldNotContain("attempt_answers_saved_total");
        text.ShouldNotContain("http_requests_total");
        text.ShouldNotContain("redis_up");
    }

    [Fact]
    public async Task 被拒的批次不污染延迟直方图()
    {
        // 批次口径统一：计数器按批次记，延迟直方图只记真正落库的批次。
        // 把被拒批次的 0 秒塞进直方图，p95 会被拉低，掩盖真实延迟。
        var registry = Metrics.NewCustomRegistry();
        var metrics = new ExamMetrics(Metrics.WithCustomRegistry(registry));

        metrics.RecordAnswerSave("saved", 0.2);
        metrics.RecordAnswerSave("duplicate");
        metrics.RecordAnswerSave("rejected");

        var text = await DumpAsync(registry);

        text.ShouldContain("attempt_answers_saved_duration_seconds_count 1");
        text.ShouldContain("attempt_answers_saved_total{result=\"saved\"} 1");
        text.ShouldContain("attempt_answers_saved_total{result=\"duplicate\"} 1");
        text.ShouldContain("attempt_answers_saved_total{result=\"rejected\"} 1");
    }

    [Fact]
    public async Task 场次结束后撤掉活跃会话序列()
    {
        // 留着 0 值序列的话，考完之后告警还会拿 0 去比考中的峰值。
        var registry = Metrics.NewCustomRegistry();
        var metrics = new WorkerMetrics(Metrics.WithCustomRegistry(registry));

        metrics.SetActiveSessions(42, 7);
        metrics.SetActiveSessions(43, 3);

        var text = await DumpAsync(registry);
        text.ShouldContain("attempt_active_sessions{examSessionId=\"42\"} 7");

        metrics.RemoveActiveSessions(42);

        text = await DumpAsync(registry);
        text.ShouldNotContain("examSessionId=\"42\"");
        text.ShouldContain("attempt_active_sessions{examSessionId=\"43\"} 3");
    }

    private static async Task<string> DumpAsync(CollectorRegistry registry)
    {
        using var stream = new MemoryStream();
        await registry.CollectAndExportAsTextAsync(stream);

        return Encoding.UTF8.GetString(stream.ToArray());
    }
}

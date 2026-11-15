using Exam.Application.Common.Interfaces;
using Prometheus;

namespace Exam.Infrastructure.Observability;

/// <summary>
/// Worker 进程的业务指标。
/// <para>
/// 只在 Worker 进程解析：API 侧的指标在 <see cref="ExamMetrics"/>。
/// 指标端口在 Worker 上单独开（:9090/metrics），Prometheus 抓两处即可。
/// </para>
/// </summary>
public sealed class WorkerMetrics : IWorkerMetrics
{
    private readonly Histogram _jobDuration;
    private readonly Counter _jobFailures;
    private readonly Gauge _outboxPending;
    private readonly Counter _reconciliationFindings;
    private readonly Gauge _activeSessions;
    private readonly Gauge _databaseActive;
    private readonly Gauge _databaseMax;
    private readonly Gauge _databaseAvailable;

    public WorkerMetrics(IMetricFactory factory)
    {
        _jobDuration = factory.CreateHistogram(
            "background_job_duration_seconds",
            "后台作业耗时（秒）",
            new HistogramConfiguration
            {
                LabelNames = ["job"],
                Buckets = Histogram.ExponentialBuckets(0.5, 2, 12),
            });

        _jobFailures = factory.CreateCounter(
            "background_job_failures_total",
            "后台作业失败次数",
            new CounterConfiguration { LabelNames = ["job"] });

        _outboxPending = factory.CreateGauge(
            "outbox_pending_messages",
            "Outbox 待派发消息数");

        _reconciliationFindings = factory.CreateCounter(
            "answer_reconciliation_findings_total",
            "答卷对账发现的差异数");

        _activeSessions = factory.CreateGauge(
            "attempt_active_sessions",
            "各场考试当前连着的作答会话数",
            new GaugeConfiguration { LabelNames = ["examSessionId"] });

        _databaseActive = factory.CreateGauge(
            "db_pool_active_connections",
            "数据库服务端当前连接数");

        _databaseMax = factory.CreateGauge(
            "db_pool_max_connections",
            "数据库服务端连接数上限");

        _databaseAvailable = factory.CreateGauge(
            "db_pool_available_connections",
            "数据库服务端剩余可用连接数");
    }

    public void RecordBackgroundJob(string job, double durationSeconds, bool failed)
    {
        _jobDuration.WithLabels(job).Observe(durationSeconds);

        if (failed)
        {
            _jobFailures.WithLabels(job).Inc();
        }
    }

    public void SetOutboxPending(long count) => _outboxPending.Set(count);

    public void RecordReconciliationFindings(long count)
    {
        if (count > 0)
        {
            _reconciliationFindings.Inc(count);
        }
    }

    public void SetActiveSessions(long examSessionId, int count) =>
        _activeSessions.WithLabels(examSessionId.ToString()).Set(count);

    public void RemoveActiveSessions(long examSessionId) =>
        _activeSessions.RemoveLabelled(examSessionId.ToString());

    public void SetDatabaseConnections(int active, int max)
    {
        _databaseActive.Set(active);
        _databaseMax.Set(max);
        _databaseAvailable.Set(Math.Max(0, max - active));
    }
}

using Exam.Application.Common.Interfaces;
using Prometheus;

namespace Exam.Infrastructure.Observability;

/// <summary>
/// API 进程的业务指标。
/// <para>
/// 只在 API 进程解析：Worker 侧的指标在 <see cref="WorkerMetrics"/>。
/// 两套指标各用一个注册表，互不污染——
/// 否则同一个指标名会被两个进程各报一次，告警里的比例就凭空翻倍。
/// </para>
/// <para>
/// 指标名与《08-deployment-operations.md》§5.1 一致，告警规则与看板按名字取用。
/// 指标在构造时就建好：即使还没发生过保存答案，<c>/metrics</c> 也要把指标名列出来，
/// 告警表达式才不会因为「指标不存在」而失效。
/// </para>
/// </summary>
public sealed class ExamMetrics : IExamMetrics
{
    private readonly Counter _answersSaved;
    private readonly Histogram _answersSavedDuration;
    private readonly Counter _answerItemsRejected;
    private readonly Counter _focusEvents;
    private readonly Counter _sessionsPublished;
    private readonly Counter _httpRequests;
    private readonly Histogram _httpDuration;
    private readonly Counter _rateLimited;
    private readonly Gauge _signalRConnections;
    private readonly Gauge _clockOffset;
    private readonly Gauge _redisUp;
    private readonly Histogram _redisDuration;

    public ExamMetrics(IMetricFactory factory)
    {
        _answersSaved = factory.CreateCounter(
            "attempt_answers_saved_total",
            "答案保存批次数（result=saved/duplicate/rejected）",
            new CounterConfiguration { LabelNames = ["result"] });

        // 延迟直方图不带 result 标签：只有真正落库的批次才观测，
        // 这样 p95 才是「落库耗时」，而不是「被拒批次的 0 秒」混进来的数。
        _answersSavedDuration = factory.CreateHistogram(
            "attempt_answers_saved_duration_seconds",
            "答案落库耗时（秒）",
            new HistogramConfiguration { Buckets = Histogram.ExponentialBuckets(0.005, 2, 12) });

        _answerItemsRejected = factory.CreateCounter(
            "attempt_answer_items_rejected_total",
            "单题被拒数（题不在卷面或载荷不合法）");

        _focusEvents = factory.CreateCounter(
            "attempt_focus_events_total",
            "焦点事件次数",
            new CounterConfiguration { LabelNames = ["type"] });

        _sessionsPublished = factory.CreateCounter(
            "exam_sessions_published_total",
            "考试场次发布次数");

        _httpRequests = factory.CreateCounter(
            "http_requests_total",
            "HTTP 请求数",
            new CounterConfiguration { LabelNames = ["method", "route", "status"] });

        _httpDuration = factory.CreateHistogram(
            "http_request_duration_seconds",
            "HTTP 请求耗时（秒）",
            new HistogramConfiguration
            {
                LabelNames = ["method", "route"],
                Buckets = Histogram.ExponentialBuckets(0.005, 2, 12),
            });

        _rateLimited = factory.CreateCounter(
            "http_rate_limited_total",
            "被限流拒绝的请求数",
            new CounterConfiguration { LabelNames = ["tier"] });

        _signalRConnections = factory.CreateGauge(
            "signalr_connections",
            "当前 SignalR 连接数");

        _clockOffset = factory.CreateGauge(
            "clock_offset_ms",
            "应用时钟与数据库时钟的偏差（毫秒，绝对值）");

        _redisUp = factory.CreateGauge(
            "redis_up",
            "Redis 是否可用（1 可用 / 0 不可用）");

        // 探测一开始就是「不可用」：Redis 挂掉时要能立刻看见 0，而不是看不见这个指标。
        _redisUp.Set(0);

        _redisDuration = factory.CreateHistogram(
            "redis_command_duration_seconds",
            "Redis 命令耗时（秒）",
            new HistogramConfiguration
            {
                LabelNames = ["op"],
                Buckets = Histogram.ExponentialBuckets(0.001, 2, 14),
            });
    }

    public void RecordAnswerSave(string result, double? durationSeconds = null)
    {
        _answersSaved.WithLabels(result).Inc();

        if (durationSeconds is { } seconds)
        {
            _answersSavedDuration.Observe(seconds);
        }
    }

    public void RecordAnswerItemsRejected(int count)
    {
        if (count > 0)
        {
            _answerItemsRejected.Inc(count);
        }
    }

    public void RecordFocusEvent(string type) => _focusEvents.WithLabels(type).Inc();

    public void RecordExamSessionPublished() => _sessionsPublished.Inc();

    public void RecordHttpRequest(string method, string route, int statusCode, double durationSeconds)
    {
        _httpRequests.WithLabels(method, route, statusCode.ToString()).Inc();
        _httpDuration.WithLabels(method, route).Observe(durationSeconds);
    }

    public void RecordRateLimited(string tier) => _rateLimited.WithLabels(tier).Inc();

    public void SignalRConnected() => _signalRConnections.Inc();

    public void SignalRDisconnected() => _signalRConnections.Dec();

    public void SetClockOffsetMs(double milliseconds) => _clockOffset.Set(milliseconds);

    public void RecordRedisCommand(string op, double durationSeconds) =>
        _redisDuration.WithLabels(op).Observe(durationSeconds);

    public void SetRedisUp(bool up) => _redisUp.Set(up ? 1 : 0);
}

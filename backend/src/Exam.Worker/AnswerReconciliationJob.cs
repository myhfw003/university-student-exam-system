using Exam.Application.Common.Interfaces;
using Exam.Application.Delivery.Services;
using Exam.Domain.SharedKernel.Abstractions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Exam.Worker;

/// <summary>
/// 答卷对账作业。
/// <para>
/// 压测不能只看 HTTP 成功率，必须**端到端核对**：客户端每批保存都带递增的序列号，
/// 服务端收到就推进会话上的最大序列号。会话上的最大序列号比库里落库的大，
/// 就说明有一批答案没落库——这正是「丢答」的定义。
/// </para>
/// <para>同一套逻辑既在压测后跑，也在生产里当定时作业跑：考试期间每 10 分钟一轮，
/// 平时每小时一轮。发现差异就写审计流水并报警。</para>
/// </summary>
public sealed class AnswerReconciliationJob : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<AnswerReconciliationJob> _logger;

    public AnswerReconciliationJob(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        ILogger<AnswerReconciliationJob> logger)
    {
        _scopeFactory = scopeFactory;
        _configuration = configuration;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromMinutes(
            _configuration.GetValue("Reconciliation:IntervalMinutes", 10));
        var lookback = TimeSpan.FromHours(
            _configuration.GetValue("Reconciliation:LookbackHours", 24));

        _logger.LogInformation(
            "答卷对账作业已启动：间隔 {Interval}，回看 {Lookback}。",
            interval,
            lookback);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunAsync(lookback, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "答卷对账作业失败，等下一轮再试。");
            }

            try
            {
                await Task.Delay(interval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task RunAsync(TimeSpan lookback, CancellationToken stoppingToken)
    {
        using var scope = _scopeFactory.CreateScope();

        var reconciler = scope.ServiceProvider.GetRequiredService<AnswerReconciler>();
        var audit = scope.ServiceProvider.GetRequiredService<IAuditRecorder>();
        var clock = scope.ServiceProvider.GetRequiredService<IClock>();

        var since = clock.UtcNow - lookback;
        var report = await reconciler.ReconcileAsync(since, cancellationToken: stoppingToken);

        if (report.IsClean)
        {
            _logger.LogInformation("答卷对账通过：核对 {Count} 份交卷，无差异。", report.CheckedAttempts);
            return;
        }

        _logger.LogError(
            "答卷对账发现 {FindingCount} 处差异，共核对 {Checked} 份交卷。",
            report.FindingCount,
            report.CheckedAttempts);

        foreach (var finding in report.Findings.Take(100))
        {
            _logger.LogError(
                "对账差异 {Kind}：作答 {AttemptId} —— {Detail}",
                finding.Kind,
                finding.AttemptId,
                finding.Detail);
        }

        // 差异留痕：进审计流水，事后可追查。
        await audit.RecordAsync(
            "attempt.reconciliation_failed",
            "reconciliation",
            report.StartedAt.ToString("O"),
            new Dictionary<string, object?>
            {
                ["checkedAttempts"] = report.CheckedAttempts,
                ["findingCount"] = report.FindingCount,
                ["findings"] = report.Findings
                    .Take(20)
                    .Select(f => new { f.AttemptId, f.ExamSessionId, f.Kind, f.Detail })
                    .ToList(),
            },
            stoppingToken);
    }
}

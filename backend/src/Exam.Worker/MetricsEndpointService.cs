using System.Net;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Prometheus;

namespace Exam.Worker;

/// <summary>
/// Worker 的指标端点。
/// <para>
/// Worker 没有对外的 HTTP 服务，但它的指标（Outbox 积压、后台作业耗时、答卷对账差异）
/// 是告警的关键输入——单独开一个只读指标端口，Prometheus 与 Web 端一起抓。
/// </para>
/// <para>
/// 端点起不来只记警告、不拖垮 Worker：指标没了要紧，后台作业停了更要紧。
/// </para>
/// </summary>
public sealed class MetricsEndpointService : BackgroundService
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<MetricsEndpointService> _logger;

    public MetricsEndpointService(
        IConfiguration configuration,
        ILogger<MetricsEndpointService> logger)
    {
        _configuration = configuration;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var port = _configuration.GetValue("Metrics:Port", 9090);

        // HttpListener 的前缀必须以 '/' 结尾，且只能以 '/' 结尾：
        // 前缀写成 http://+:9090/metrics 会抛 ArgumentException，
        // 而这个异常发生在后台服务里 → 整个 Worker 跟着停。
        // 所以前缀挂根路径，具体路径在处理请求时判断。
        using var listener = new HttpListener();

        try
        {
            listener.Prefixes.Add($"http://+:{port}/");
            listener.Start();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "指标端口 {Port} 起不来，Worker 指标这次不暴露。", port);
            return;
        }

        _logger.LogInformation("Worker 指标端点已启动：http://0.0.0.0:{Port}/metrics", port);

        while (!stoppingToken.IsCancellationRequested)
        {
            HttpListenerContext context;
            try
            {
                context = await listener.GetContextAsync();
            }
            catch (Exception) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (HttpListenerException)
            {
                break;
            }

            try
            {
                var path = context.Request.Url?.AbsolutePath ?? "/";

                if (!string.Equals(path, "/metrics", StringComparison.OrdinalIgnoreCase))
                {
                    // 不是指标路径：回 404，继续服务下一个请求。
                    context.Response.StatusCode = 404;
                    continue;
                }

                context.Response.ContentType = "text/plain; version=0.0.4; charset=utf-8";
                await Metrics.DefaultRegistry.CollectAndExportAsTextAsync(context.Response.OutputStream);
                await context.Response.OutputStream.FlushAsync();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "导出指标失败。");
            }
            finally
            {
                context.Response.Close();
            }
        }
    }
}

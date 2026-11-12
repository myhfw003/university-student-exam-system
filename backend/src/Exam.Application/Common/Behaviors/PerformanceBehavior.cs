using System.Diagnostics;
using MediatR;
using Microsoft.Extensions.Logging;

namespace Exam.Application.Common.Behaviors;

/// <summary>用时埋点。用于定位慢用例，配合 OpenTelemetry 的 span 形成完整链路。</summary>
public sealed class PerformanceBehavior<TRequest, TResponse> : IPipelineBehavior<TRequest, TResponse>
    where TRequest : notnull
{
    private readonly ILogger<PerformanceBehavior<TRequest, TResponse>> _logger;

    public PerformanceBehavior(ILogger<PerformanceBehavior<TRequest, TResponse>> logger) => _logger = logger;

    public async Task<TResponse> Handle(
        TRequest request,
        RequestHandlerDelegate<TResponse> next,
        CancellationToken cancellationToken)
    {
        var stopwatch = Stopwatch.StartNew();
        var response = await next();
        stopwatch.Stop();

        _logger.LogDebug(
            "用例 {RequestName} 耗时 {ElapsedMilliseconds} 毫秒",
            typeof(TRequest).Name,
            stopwatch.ElapsedMilliseconds);

        return response;
    }
}

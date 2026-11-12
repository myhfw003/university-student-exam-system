using MediatR;
using Microsoft.Extensions.Logging;

namespace Exam.Application.Common.Behaviors;

/// <summary>结构化请求日志。热路径（日志级别 Debug）记录详情，Information 只记录摘要。</summary>
public sealed class LoggingBehavior<TRequest, TResponse> : IPipelineBehavior<TRequest, TResponse>
    where TRequest : notnull
{
    private readonly ILogger<LoggingBehavior<TRequest, TResponse>> _logger;

    public LoggingBehavior(ILogger<LoggingBehavior<TRequest, TResponse>> logger) => _logger = logger;

    public async Task<TResponse> Handle(
        TRequest request,
        RequestHandlerDelegate<TResponse> next,
        CancellationToken cancellationToken)
    {
        var name = typeof(TRequest).Name;
        _logger.LogDebug("开始处理 {RequestName}", name);

        var response = await next();

        _logger.LogDebug("处理完成 {RequestName}", name);
        return response;
    }
}

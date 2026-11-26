using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Web.Middleware;

/// <summary>
/// 全局异常处理。领域异常映射为携带稳定错误码的 ProblemDetails；
/// 未预期异常统一返回 500 且不泄露内部细节。
/// </summary>
public sealed class ExceptionHandlingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionHandlingMiddleware> _logger;
    private readonly IHostEnvironment _environment;

    public ExceptionHandlingMiddleware(
        RequestDelegate next,
        ILogger<ExceptionHandlingMiddleware> logger,
        IHostEnvironment environment)
    {
        _next = next;
        _logger = logger;
        _environment = environment;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (Application.Common.Exceptions.ValidationException ex)
        {
            _logger.LogInformation("请求参数校验失败：{ErrorCode}", ex.ErrorCode);
            await WriteProblemAsync(context, ex.ErrorCode, ex.Message, StatusCodes.Status400BadRequest, ex.Errors);
        }
        catch (Application.Common.Exceptions.NotFoundException ex)
        {
            _logger.LogInformation("资源不存在：{ErrorCode}", ex.ErrorCode);
            await WriteProblemAsync(context, ex.ErrorCode, ex.Message, StatusCodes.Status404NotFound, null);
        }
        catch (Application.Common.Exceptions.ForbiddenException ex)
        {
            _logger.LogInformation("权限不足：{ErrorCode}", ex.ErrorCode);
            await WriteProblemAsync(context, ex.ErrorCode, ex.Message, StatusCodes.Status403Forbidden, null);
        }
        catch (Application.Common.Exceptions.ConcurrencyConflictException ex)
        {
            _logger.LogInformation("并发冲突：{ErrorCode}", ex.ErrorCode);
            await WriteProblemAsync(context, ex.ErrorCode, ex.Message, StatusCodes.Status409Conflict, null);
        }
        catch (Application.Common.Exceptions.AiGenerationFailedException ex)
        {
            // 上游模型服务的问题：报 502（网关错误），别混进 422 的业务规则里。
            _logger.LogWarning(ex, "AI 服务调用失败：{ErrorCode}", ex.ErrorCode);
            await WriteProblemAsync(context, ex.ErrorCode, ex.Message, StatusCodes.Status502BadGateway, null);
        }
        catch (Exam.Domain.Delivery.AttemptDeadlineExceededException ex)
        {
            // 超时不是业务规则错误，是状态冲突：前端应立即触发交卷。
            _logger.LogInformation("作答超时：{ErrorCode}", ex.ErrorCode);
            await WriteProblemAsync(context, ex.ErrorCode, ex.Message, StatusCodes.Status409Conflict, null);
        }
        catch (DomainException ex)
        {
            _logger.LogWarning(ex, "业务规则拒绝：{ErrorCode} {Message}", ex.ErrorCode, ex.Message);
            await WriteProblemAsync(
                context,
                ex.ErrorCode,
                ex.Message,
                StatusCodes.Status422UnprocessableEntity,
                ex.Errors,
                ex.Payload);
        }
        catch (UnauthorizedAccessException ex)
        {
            _logger.LogWarning(ex, "未授权访问。");
            await WriteProblemAsync(context, ErrorCodes.Forbidden, ex.Message, StatusCodes.Status403Forbidden, null);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            // 客户端断开，非服务端错误。
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "未处理异常：{Path}", context.Request.Path);

            // 非生产环境把异常细节带出来，否则开发期只能看到一个 500 和 TraceId。
            var detail = _environment.IsProduction()
                ? "服务器内部错误，请稍后重试并提供 TraceId。"
                : $"服务器内部错误：{ex.GetType().Name}: {ex.Message}";

            await WriteProblemAsync(
                context,
                20500,
                detail,
                StatusCodes.Status500InternalServerError,
                null);
        }
    }

    private static Task WriteProblemAsync(
        HttpContext context,
        int errorCode,
        string detail,
        int statusCode,
        IReadOnlyDictionary<string, string[]>? errors,
        IReadOnlyDictionary<string, object?>? payload = null)
        => ProblemDetailsWriter.WriteAsync(context, errorCode, detail, statusCode, errors, payload);
}

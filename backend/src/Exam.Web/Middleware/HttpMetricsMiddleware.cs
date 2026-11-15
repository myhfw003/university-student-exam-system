using System.Diagnostics;
using Exam.Application.Common.Interfaces;
using Microsoft.AspNetCore.Routing;

namespace Exam.Web.Middleware;

/// <summary>
/// HTTP 请求指标。
/// <para>
/// 路由标签取路由模板（api/v1/attempts/{id}），不取原始路径——
/// 原始路径由客户端控制，拿它当标签等于把标签基数交给攻击者，
/// 一条 404 风暴就能把时序库撑爆。
/// </para>
/// <para>
/// 指标端点自身不计入：采集请求不是业务流量，混进去会稀释错误率。
/// </para>
/// </summary>
public sealed class HttpMetricsMiddleware
{
    private readonly RequestDelegate _next;
    private readonly IExamMetrics _metrics;

    public HttpMetricsMiddleware(RequestDelegate next, IExamMetrics metrics)
    {
        _next = next;
        _metrics = metrics;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var stopwatch = Stopwatch.StartNew();
        var status = 500;

        try
        {
            await _next(context);
            status = context.Response.StatusCode;
        }
        finally
        {
            // 异常统一由上游的 ExceptionHandlingMiddleware 转成 500，
            // 这里先记 500：没处理掉的异常就是要按 500 统计。
            var route = (context.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText ?? "unmatched";

            if (!string.Equals(route, "metrics", StringComparison.Ordinal))
            {
                _metrics.RecordHttpRequest(
                    context.Request.Method,
                    route,
                    status,
                    stopwatch.Elapsed.TotalSeconds);
            }
        }
    }
}

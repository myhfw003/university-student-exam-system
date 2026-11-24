using System.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace Exam.Web.Middleware;

/// <summary>
/// 统一的 ProblemDetails 输出。
/// <para>
/// 错误码是前后端共享的契约（docs/design/05-api.md §1.2）：响应体里必须带
/// <c>errorCode</c> 与 <c>traceId</c>，前端才能把「对象存储没开」这类错误
/// 显示成对应的话，而不是笼统的「网络异常」。
/// </para>
/// <para>
/// 异常处理与限流拒绝都走这里，避免两处各写一套字段。
/// </para>
/// </summary>
internal static class ProblemDetailsWriter
{
    public static async Task WriteAsync(
        HttpContext context,
        int errorCode,
        string detail,
        int statusCode,
        IReadOnlyDictionary<string, string[]>? errors,
        IReadOnlyDictionary<string, object?>? payload = null)
    {
        if (context.Response.HasStarted)
        {
            return;
        }

        var problem = new ProblemDetails
        {
            Type = $"https://api.example.edu/errors/{errorCode}",
            Title = detail,
            Status = statusCode,
            Detail = detail,
            Instance = context.Request.Path,
        };

        problem.Extensions["errorCode"] = errorCode;
        problem.Extensions["traceId"] = Activity.Current?.Id ?? context.TraceIdentifier;

        if (errors is { Count: > 0 })
        {
            problem.Extensions["errors"] = errors;
        }

        // 结构化载荷：缺什么、差多少这类明细直接进响应体。
        if (payload is { Count: > 0 })
        {
            foreach (var (key, value) in payload)
            {
                problem.Extensions[key] = value;
            }
        }

        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "application/problem+json";

        await context.Response.WriteAsJsonAsync(problem);
    }
}

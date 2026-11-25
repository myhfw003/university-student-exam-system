using Exam.Application.Common.Interfaces;
using Microsoft.AspNetCore.Http;

namespace Exam.Web.Security;

/// <summary>请求上下文。取客户端 IP 与 User-Agent，用于审计与令牌族滥用追踪。</summary>
public sealed class HttpRequestContext : IRequestContext
{
    private readonly IHttpContextAccessor _accessor;

    public HttpRequestContext(IHttpContextAccessor accessor) => _accessor = accessor;

    /// <summary>
    /// 客户端地址。与限流的分区键取自同一处、同样归一：
    /// 审计里记的 IP 要能直接对上「是谁触发的限流」。
    /// </summary>
    public string? IpAddress => ClientAddress.Normalize(_accessor.HttpContext?.Connection.RemoteIpAddress);

    public string? UserAgent => _accessor.HttpContext?.Request.Headers.UserAgent.ToString();
}

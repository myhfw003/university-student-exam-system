using Exam.Application.Common.Interfaces;
using Microsoft.AspNetCore.Http;

namespace Exam.Web.Security;

/// <summary>请求上下文。取客户端 IP 与 User-Agent，用于审计与令牌族滥用追踪。</summary>
public sealed class HttpRequestContext : IRequestContext
{
    private readonly IHttpContextAccessor _accessor;

    public HttpRequestContext(IHttpContextAccessor accessor) => _accessor = accessor;

    public string? IpAddress => _accessor.HttpContext?.Connection.RemoteIpAddress?.ToString();

    public string? UserAgent => _accessor.HttpContext?.Request.Headers.UserAgent.ToString();
}

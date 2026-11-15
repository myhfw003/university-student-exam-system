using Exam.Application.Common.Interfaces;

namespace Exam.Worker;

/// <summary>
/// 后台进程的请求上下文。
/// <para>
/// Worker 没有 HTTP 请求：客户端 IP 与 User-Agent 都取不到，审计里留空。
/// </para>
/// <para>
/// 必须有它：审计记录器要读请求上下文，不提供实现的话后台作业写审计会直接失败。
/// </para>
/// </summary>
public sealed class BackgroundRequestContext : IRequestContext
{
    public string? IpAddress => null;

    public string? UserAgent => null;
}

namespace Exam.Application.Common.Interfaces;

/// <summary>请求上下文（客户端 IP、User-Agent）。用于审计与令牌族滥用追踪。</summary>
public interface IRequestContext
{
    string? IpAddress { get; }

    string? UserAgent { get; }
}

using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Application.Common.Exceptions;

/// <summary>请求参数校验失败。映射为 HTTP 400。</summary>
public sealed class ValidationException : DomainException
{
    public ValidationException(IReadOnlyDictionary<string, string[]> errors)
        : base("请求参数校验失败。", ErrorCodes.ValidationFailed, errors) { }
}

/// <summary>资源不存在或无权访问。映射为 HTTP 404（不泄露资源存在性）。</summary>
public sealed class NotFoundException : DomainException
{
    public NotFoundException(string message = "资源不存在。")
        : base(message, ErrorCodes.NotFound) { }
}

/// <summary>缺少操作权限。映射为 HTTP 403。</summary>
public sealed class ForbiddenException : DomainException
{
    public ForbiddenException(string message = "没有执行该操作的权限。")
        : base(message, ErrorCodes.Forbidden) { }
}

/// <summary>乐观并发冲突。映射为 HTTP 409。</summary>
public sealed class ConcurrencyConflictException : DomainException
{
    public ConcurrencyConflictException(string message = "数据已被他人修改，请刷新后重试。")
        : base(message, ErrorCodes.ConcurrencyConflict) { }
}

/// <summary>
/// AI 服务没配好（没填 API Key，或压根没有可用供应商）。
/// <para>映射为 HTTP 422：请求本身没问题，是服务端配置缺了。</para>
/// </summary>
public sealed class AiProviderNotConfiguredException : DomainException
{
    public AiProviderNotConfiguredException(string message)
        : base(message, ErrorCodes.AiProviderNotConfigured) { }
}

/// <summary>
/// 调用 AI 服务失败（网络不通、供应商报错、返回内容读不出来）。
/// <para>映射为 HTTP 502：上游的问题，不是本服务的业务规则。</para>
/// </summary>
public sealed class AiGenerationFailedException : DomainException
{
    public AiGenerationFailedException(string message)
        : base(message, ErrorCodes.AiGenerationFailed) { }
}

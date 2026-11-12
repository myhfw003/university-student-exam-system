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

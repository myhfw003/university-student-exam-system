namespace Exam.Domain.SharedKernel.Exceptions;

/// <summary>领域异常基类。错误码是稳定契约，面向用户的中文消息与错误码一一对应。</summary>
public class DomainException : Exception
{
    public DomainException(string message, int errorCode)
        : base(message) => ErrorCode = errorCode;

    public DomainException(string message, int errorCode, IReadOnlyDictionary<string, string[]> errors)
        : base(message)
    {
        ErrorCode = errorCode;
        Errors = errors;
    }

    /// <summary>
    /// 带结构化载荷的异常。载荷会原样写进错误响应，
    /// 让前端能直接拿到「缺什么、差多少」这类明细，而不用再发一次请求。
    /// </summary>
    public DomainException(
        string message,
        int errorCode,
        IReadOnlyDictionary<string, object?> payload)
        : base(message)
    {
        ErrorCode = errorCode;
        Payload = payload;
    }

    public int ErrorCode { get; }

    public IReadOnlyDictionary<string, string[]> Errors { get; } = new Dictionary<string, string[]>();

    /// <summary>错误响应里的附加数据。</summary>
    public IReadOnlyDictionary<string, object?> Payload { get; } = new Dictionary<string, object?>();
}

/// <summary>违反业务规则。</summary>
public sealed class BusinessRuleException : DomainException
{
    public BusinessRuleException(string message)
        : base(message, ErrorCodes.BusinessRuleViolated) { }

    public BusinessRuleException(string message, IReadOnlyDictionary<string, string[]> errors)
        : base(message, ErrorCodes.BusinessRuleViolated, errors) { }
}

/// <summary>非法的状态流转。</summary>
public sealed class InvalidStateTransitionException : DomainException
{
    public InvalidStateTransitionException(string message)
        : base(message, ErrorCodes.InvalidStateTransition) { }
}

/// <summary>系统尚未配置原始密码，无法重置密码。</summary>
public sealed class OriginalPasswordNotConfiguredException : DomainException
{
    public OriginalPasswordNotConfiguredException(string message)
        : base(message, ErrorCodes.OriginalPasswordNotConfigured) { }
}

/// <summary>业务编码重复。</summary>
public sealed class DuplicateCodeException : DomainException
{
    public DuplicateCodeException(string message)
        : base(message, ErrorCodes.DuplicateCode) { }
}

/// <summary>对象存储未启用或未配置，附件与文件导入做不了。</summary>
public sealed class ObjectStorageUnavailableException : DomainException
{
    public ObjectStorageUnavailableException(string message)
        : base(message, ErrorCodes.ObjectStorageUnavailable) { }
}

/// <summary>标签被引用，不可删除。</summary>
public sealed class TagInUseException : DomainException
{
    public TagInUseException(string message)
        : base(message, ErrorCodes.TagInUse) { }
}

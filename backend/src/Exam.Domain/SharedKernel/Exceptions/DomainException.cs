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

    public int ErrorCode { get; }

    public IReadOnlyDictionary<string, string[]> Errors { get; } = new Dictionary<string, string[]>();
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

/// <summary>业务编码重复。</summary>
public sealed class DuplicateCodeException : DomainException
{
    public DuplicateCodeException(string message)
        : base(message, ErrorCodes.DuplicateCode) { }
}

/// <summary>标签被引用，不可删除。</summary>
public sealed class TagInUseException : DomainException
{
    public TagInUseException(string message)
        : base(message, ErrorCodes.TagInUse) { }
}

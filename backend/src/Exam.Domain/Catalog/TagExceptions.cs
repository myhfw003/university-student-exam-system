using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Catalog;

/// <summary>标签层级成环。</summary>
public sealed class TagCycleException : DomainException
{
    public TagCycleException(string message)
        : base(message, ErrorCodes.TagCycleDetected) { }
}

/// <summary>标签被引用，不可删除。</summary>
public sealed class TagUsageException : DomainException
{
    public TagUsageException(string message)
        : base(message, ErrorCodes.TagReferenced) { }
}

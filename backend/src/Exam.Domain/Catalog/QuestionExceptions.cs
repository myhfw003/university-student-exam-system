using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Catalog;

/// <summary>题目内容不合法。携带逐字段的违规说明。</summary>
public sealed class QuestionValidationException : DomainException
{
    public QuestionValidationException(
        string message,
        IReadOnlyDictionary<string, string[]> errors)
        : base(message, ErrorCodes.QuestionInvalid, errors) { }

    public QuestionValidationException(string message)
        : base(message, ErrorCodes.QuestionInvalid) { }
}

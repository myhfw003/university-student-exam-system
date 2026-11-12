namespace Exam.Domain.SharedKernel.Exceptions;

/// <summary>
/// 领域错误码。码段划分：2xxxx 通用、21xxx 状态流转、22xxx 唯一性、23xxx 题目、
/// 24xxx 试卷、25xxx 会话、26xxx 评分、27xxx 导入、28xxx 标签、29xxx 身份。
/// </summary>
public static class ErrorCodes
{
    public const int ValidationFailed = 20001;
    public const int ConcurrencyConflict = 20002;
    public const int NotFound = 20003;
    public const int Forbidden = 20004;
    public const int BusinessRuleViolated = 20005;

    public const int InvalidStateTransition = 21001;

    public const int DuplicateCode = 22001;
    public const int TagInUse = 22101;

    public const int QuestionInvalid = 23001;
    public const int InsufficientQuestionPool = 23101;

    public const int PaperPublicationRejected = 24001;
    public const int PaperImmutable = 24101;

    public const int AttemptStateInvalid = 25001;
    public const int AttemptDeadlineExceeded = 25002;
    public const int AttemptAlreadySubmitted = 25003;
    public const int ParticipantQuotaExceeded = 25004;
    public const int FocusLimitExceeded = 25101;

    public const int ScoringFailed = 26001;

    public const int ImportRowInvalid = 27001;

    public const int TagCycleDetected = 28001;
    public const int TagReferenced = 28002;

    public const int CredentialsInvalid = 29001;
    public const int AccountLocked = 29002;
    public const int AccountDisabled = 29003;
    public const int RefreshTokenReuseDetected = 29004;
}

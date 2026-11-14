namespace Exam.Web.Api.Contracts;

/// <summary>开始作答。考试传 examSessionId，练习传 practiceAssignmentId。</summary>
public sealed record StartAttemptRequest(long? ExamSessionId, long? PracticeAssignmentId);

/// <summary>批量保存答案。</summary>
public sealed record SaveAnswersRequest(int ClientSeq, IReadOnlyList<SaveAnswerItemRequest> Items);

/// <summary>一条待保存的答案。</summary>
public sealed record SaveAnswerItemRequest(long QuestionId, AnswerPayloadRequest Payload);

/// <summary>答案载荷。</summary>
public sealed record AnswerPayloadRequest(
    IReadOnlyList<string>? SelectedOptionKeys,
    string? Text,
    IReadOnlyList<AnswerStepRequest>? Steps);

/// <summary>综合题的分步作答。</summary>
public sealed record AnswerStepRequest(string? Code, string? Text);

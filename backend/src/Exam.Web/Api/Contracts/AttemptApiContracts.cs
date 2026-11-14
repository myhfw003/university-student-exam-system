namespace Exam.Web.Api.Contracts;

/// <summary>开始作答。考试传 examSessionId，练习传 practiceAssignmentId。</summary>
public sealed record StartAttemptRequest(long? ExamSessionId, long? PracticeAssignmentId);

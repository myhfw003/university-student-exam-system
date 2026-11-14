namespace Exam.Web.Api.Contracts;

/// <summary>把阅卷任务指派给某个阅卷人。</summary>
public sealed record AssignReviewTaskRequest(long UserId);

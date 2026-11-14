namespace Exam.Web.Api.Contracts;

/// <summary>把阅卷任务指派给某个阅卷人。</summary>
public sealed record AssignReviewTaskRequest(long UserId);

/// <summary>人工评分。分数 0..满分、0.5 为步进；评语学生可见。</summary>
public sealed record GradeReviewTaskRequest(decimal Score, string? Comment);

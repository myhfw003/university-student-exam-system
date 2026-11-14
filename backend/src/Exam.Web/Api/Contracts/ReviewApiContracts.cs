namespace Exam.Web.Api.Contracts;

/// <summary>把阅卷任务指派给某个阅卷人。</summary>
public sealed record AssignReviewTaskRequest(long UserId);

/// <summary>人工评分。分数 0..满分、0.5 为步进；评语学生可见。</summary>
public sealed record GradeReviewTaskRequest(decimal Score, string? Comment);

/// <summary>
/// 批量采纳初判建议。
/// <para>
/// <c>confirm</c> 必须为 true：批量定分不可逆，客户端先做二次确认。
/// </para>
/// </summary>
public sealed record BatchAdoptReviewTasksRequest(
    IReadOnlyList<long>? TaskIds,
    long? ExamSessionId,
    long? QuestionId,
    int? MaxCount,
    string? Comment,
    bool Confirm);

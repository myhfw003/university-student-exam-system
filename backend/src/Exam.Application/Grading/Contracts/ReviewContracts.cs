namespace Exam.Application.Grading.Contracts;

/// <summary>阅卷任务。</summary>
public sealed record ReviewTaskDto(
    long Id,
    long AttemptId,
    int AttemptNo,
    string ExamName,
    long? ExamSessionId,
    long QuestionId,
    string QuestionCode,
    string QuestionType,
    string? StepCode,
    string AnswerText,
    decimal? SuggestedScore,
    decimal MaxScore,
    string Status,
    string StatusLabel,
    long? AssigneeId,
    long? ReviewerId,
    decimal? FinalScore,
    string? Comment,
    DateTimeOffset CreatedAt,
    DateTimeOffset? ReviewedAt);

/// <summary>阅卷任务列表。</summary>
public sealed record ReviewTaskListResponse(
    IReadOnlyList<ReviewTaskDto> Items,
    int Total,
    int Page,
    int Size);

/// <summary>阅卷任务计数。</summary>
public sealed record ReviewTaskCountDto(
    int Pending,
    int InReview,
    int Reviewed,
    int Mine);

/// <summary>
/// 队列中的上一份 / 下一份。
/// <para>
/// 连续阅卷用：交完一份就能接着领下一份，不用翻页。
/// </para>
/// </summary>
public sealed record ReviewTaskNeighborsDto(
    long? PreviousId,
    long? NextId);

/// <summary>阅卷卷宗详情：作答原文 + 参考答案 + 系统初判的要点命中。</summary>
public sealed record ReviewTaskDetailDto(
    ReviewTaskDto Task,
    string Stem,
    string QuestionType,
    string QuestionTypeLabel,
    string? ReferenceAnswer,
    string? Analysis,
    IReadOnlyList<ReviewKeypointDto> Keypoints,
    IReadOnlyList<ReviewStepDto> Steps,
    IReadOnlyList<string> HitItems,
    IReadOnlyList<string> MissedItems,
    IReadOnlyList<string> Notes,
    string? StudentUsername,
    string? StudentDisplayName);

/// <summary>评分要点的命中情况。</summary>
public sealed record ReviewKeypointDto(
    string Text,
    bool Hit);

/// <summary>综合题步骤的命中情况。</summary>
public sealed record ReviewStepDto(
    string Code,
    string Prompt,
    decimal Score,
    bool Hit);

/// <summary>
/// 评分结果。
/// <para>
/// 阅卷人提交后立刻能看到这道题现在的状态：定了分没有、改了几次。
/// </para>
/// </summary>
public sealed record GradeReviewTaskResponse(
    long ReviewTaskId,
    string Status,
    string StatusLabel,
    decimal FinalScore,
    decimal MaxScore,
    string? Comment,
    string ScoreResultStatus,
    string ScoreResultStatusLabel,
    int Revision);

/// <summary>一条改分流水。学生端可见。</summary>
public sealed record GradeRevisionDto(
    long Id,
    long QuestionId,
    long ScoreResultId,
    decimal? PreviousScore,
    decimal NewScore,
    string? Comment,
    long OperatorId,
    DateTimeOffset OccurredAt);

/// <summary>改分流水列表。</summary>
public sealed record GradeRevisionListResponse(
    long AttemptId,
    IReadOnlyList<GradeRevisionDto> Items,
    int Total);

/// <summary>批量采纳初判：逐条结果。</summary>
public sealed record BatchAdoptItemDto(
    long TaskId,
    string Status,
    string StatusLabel,
    decimal? FinalScore,
    string? Message);

/// <summary>
/// 批量采纳初判的结果。
/// <para>
/// 逐条给出：哪些采纳了、哪些跳过了、跳过是为什么。
/// </para>
/// </summary>
public sealed record BatchAdoptResponse(
    int Total,
    int Adopted,
    int Skipped,
    IReadOnlyList<BatchAdoptItemDto> Items);

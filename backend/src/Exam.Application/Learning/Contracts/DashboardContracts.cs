namespace Exam.Application.Learning.Contracts;

/// <summary>进行中的考试。</summary>
public sealed record OngoingExamDto(
    long ExamSessionId,
    string Name,
    DateTimeOffset OpenAt,
    DateTimeOffset CloseAt,
    string? Note,
    bool Started);

/// <summary>推荐练习。</summary>
public sealed record RecommendedPracticeDto(
    long Id,
    string Title,
    IReadOnlyList<string> TagNames);

/// <summary>一条成绩记录。考试与练习都算，<c>Kind</c> 区分。</summary>
public sealed record RecentResultDto(
    long AttemptId,
    string Kind,
    string Name,
    DateTimeOffset Date,
    decimal Score,
    decimal Total,
    string Status);

/// <summary>成绩趋势上的一个点。按时间正序。</summary>
public sealed record ScoreTrendPointDto(
    DateTimeOffset Date,
    decimal Score,
    decimal Total);

/// <summary>错题分布的一个分组。</summary>
public sealed record MistakeDistributionDto(
    string TagName,
    string Group,
    int Count);

/// <summary>学生工作台汇总。</summary>
public sealed record DashboardSummaryResponse(
    int PendingPractices,
    int OngoingExams,
    decimal? TermAverageScore,
    int PendingMistakes,
    OngoingExamDto? OngoingExam,
    IReadOnlyList<RecommendedPracticeDto> RecommendedPractices,
    IReadOnlyList<RecentResultDto> RecentResults,
    IReadOnlyList<ScoreTrendPointDto> ScoreTrend,
    IReadOnlyList<MistakeDistributionDto> MistakeDistribution,
    DateTimeOffset GeneratedAt);

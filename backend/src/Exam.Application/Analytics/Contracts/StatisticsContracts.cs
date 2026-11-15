using Exam.Domain.Analytics;

namespace Exam.Application.Analytics.Contracts;

/// <summary>一次作答的事实。统计只用得到这几个字段。</summary>
public sealed record ExamAttemptFact(
    long AttemptId,
    long UserId,
    int AttemptNo,
    bool IsSubmitted,
    DateTimeOffset? SubmittedAt);

/// <summary>一道题的得分事实。<c>IsAnswered</c> 表示这份作答真的落了笔。</summary>
public sealed record ExamScoreFact(
    long AttemptId,
    long QuestionId,
    decimal Score,
    decimal MaxScore,
    bool IsAnswered);

/// <summary>一次重算的产物：场次级 + 逐题 + 题型。</summary>
public sealed record ExamStatisticComputation(
    ExamStatistic ExamStatistic,
    IReadOnlyList<QuestionStatistic> Questions,
    IReadOnlyList<TypeStatistic> Types);

/// <summary>分数段。</summary>
public sealed record ScoreBucketDto(string Label, int Count);

/// <summary>题型统计。</summary>
public sealed record TypeStatisticDto(
    string Type,
    string TypeLabel,
    int AnsweredCount,
    decimal? AverageScore,
    decimal? ScoreRate);

/// <summary>逐题统计。</summary>
public sealed record QuestionStatisticDto(
    long QuestionId,
    string Code,
    string Type,
    string TypeLabel,
    decimal MaxScore,
    int AnsweredCount,
    int CorrectCount,
    decimal? CorrectRate,
    decimal? AverageScore,
    decimal? Mastery);

/// <summary>一场考试的成绩分析。</summary>
public sealed record ExamSessionStatisticsResponse(
    long ExamSessionId,
    string ExamSessionName,
    int ParticipantCount,
    int SubmittedCount,
    int AbsentCount,
    decimal? AverageScore,
    decimal? MaxScore,
    decimal? MinScore,
    decimal? ScoreRange,
    decimal? PassRate,
    decimal? ExcellentRate,
    IReadOnlyList<ScoreBucketDto> ScoreBuckets,
    IReadOnlyList<TypeStatisticDto> TypeStatistics,
    IReadOnlyList<QuestionStatisticDto> QuestionStatistics,
    DateTimeOffset UpdatedAt);

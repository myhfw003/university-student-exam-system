namespace Exam.Domain.Analytics;

/// <summary>
/// 题型统计读模型。一场考试 × 一个题型一行。
/// <para>
/// 口径与逐题一致：只统计真正作答（非空白）的人次。
/// </para>
/// </summary>
public sealed class TypeStatistic : StatisticEntity
{
    private TypeStatistic() { }

    private TypeStatistic(
        long examSessionId,
        string questionType,
        int answeredCount,
        decimal? averageScore,
        decimal? scoreRate,
        DateTimeOffset now)
        : base(now)
    {
        ExamSessionId = examSessionId;
        QuestionType = questionType;
        AnsweredCount = answeredCount;
        AverageScore = averageScore;
        ScoreRate = scoreRate;
    }

    /// <summary>所属考试场次。</summary>
    public long ExamSessionId { get; private set; }

    /// <summary>题型（存储值：single / multi / judge / short / comprehensive）。</summary>
    public string QuestionType { get; private set; } = string.Empty;

    /// <summary>作答应数：该题型下真正落笔（非空白）的人次。</summary>
    public int AnsweredCount { get; private set; }

    /// <summary>平均得分。</summary>
    public decimal? AverageScore { get; private set; }

    /// <summary>得分率（0..1）：总得分 ÷ 总满分。</summary>
    public decimal? ScoreRate { get; private set; }

    /// <summary>新建一行题型统计。</summary>
    public static TypeStatistic Create(
        long examSessionId,
        string questionType,
        int answeredCount,
        decimal? averageScore,
        decimal? scoreRate,
        DateTimeOffset now) =>
        new(
            examSessionId,
            questionType,
            answeredCount,
            averageScore,
            scoreRate,
            now);
}

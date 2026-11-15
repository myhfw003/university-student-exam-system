namespace Exam.Domain.Analytics;

/// <summary>
/// 逐题统计读模型。一场考试 × 一道题一行。
/// <para>
/// 口径：**只统计真正作答（非空白）的人次**。空白答案不计入分母——
/// 没作答的人不该拉低这道题的平均分。
/// </para>
/// </summary>
public sealed class QuestionStatistic : StatisticEntity
{
    private QuestionStatistic() { }

    private QuestionStatistic(
        long examSessionId,
        long questionId,
        int answeredCount,
        int correctCount,
        decimal? averageScore,
        decimal? masteryRate,
        DateTimeOffset now)
        : base(now)
    {
        ExamSessionId = examSessionId;
        QuestionId = questionId;
        AnsweredCount = answeredCount;
        CorrectCount = correctCount;
        AverageScore = averageScore;
        MasteryRate = masteryRate;
    }

    /// <summary>所属考试场次。</summary>
    public long ExamSessionId { get; private set; }

    /// <summary>题目。</summary>
    public long QuestionId { get; private set; }

    /// <summary>作答应数：真正落笔（非空白）的人次。</summary>
    public int AnsweredCount { get; private set; }

    /// <summary>满分人次：拿到这道题满分的人次。</summary>
    public int CorrectCount { get; private set; }

    /// <summary>平均得分。</summary>
    public decimal? AverageScore { get; private set; }

    /// <summary>掌握度（0..1）：总得分 ÷ 总满分。</summary>
    public decimal? MasteryRate { get; private set; }

    /// <summary>新建一行逐题统计。</summary>
    public static QuestionStatistic Create(
        long examSessionId,
        long questionId,
        int answeredCount,
        int correctCount,
        decimal? averageScore,
        decimal? masteryRate,
        DateTimeOffset now) =>
        new(
            examSessionId,
            questionId,
            answeredCount,
            correctCount,
            averageScore,
            masteryRate,
            now);
}

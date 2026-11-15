namespace Exam.Domain.Analytics;

/// <summary>
/// 场次级统计读模型。一场考试一行。
/// <para>
/// 读模型：只反映当前事实，不留历史。改分、发布成绩之后重算即变。
/// </para>
/// </summary>
public sealed class ExamStatistic : StatisticEntity
{
    private ExamStatistic() { }

    private ExamStatistic(
        long examSessionId,
        int participantCount,
        int submittedCount,
        int absentCount,
        decimal? averageScore,
        decimal? maxScore,
        decimal? minScore,
        decimal? passRate,
        decimal? excellentRate,
        IReadOnlyDictionary<string, int> scoreBuckets,
        DateTimeOffset now)
        : base(now)
    {
        ExamSessionId = examSessionId;
        ParticipantCount = participantCount;
        SubmittedCount = submittedCount;
        AbsentCount = absentCount;
        AverageScore = averageScore;
        MaxScore = maxScore;
        MinScore = minScore;
        PassRate = passRate;
        ExcellentRate = excellentRate;
        ScoreBuckets = scoreBuckets;
    }

    /// <summary>所属考试场次。</summary>
    public long ExamSessionId { get; private set; }

    /// <summary>应考人数：名单上的考生；没有名单时取有作答记录的考生数。</summary>
    public int ParticipantCount { get; private set; }

    /// <summary>已交卷人数。</summary>
    public int SubmittedCount { get; private set; }

    /// <summary>缺考人数：应考但没交卷。</summary>
    public int AbsentCount { get; private set; }

    /// <summary>平均总分。</summary>
    public decimal? AverageScore { get; private set; }

    /// <summary>最高总分。</summary>
    public decimal? MaxScore { get; private set; }

    /// <summary>最低总分。</summary>
    public decimal? MinScore { get; private set; }

    /// <summary>及格率（0..1）。</summary>
    public decimal? PassRate { get; private set; }

    /// <summary>优秀率（0..1）。</summary>
    public decimal? ExcellentRate { get; private set; }

    /// <summary>分数段分布：标签 → 份数。</summary>
    public IReadOnlyDictionary<string, int> ScoreBuckets { get; private set; } =
        new Dictionary<string, int>();

    /// <summary>新建一行统计。</summary>
    public static ExamStatistic Create(
        long examSessionId,
        int participantCount,
        int submittedCount,
        int absentCount,
        decimal? averageScore,
        decimal? maxScore,
        decimal? minScore,
        decimal? passRate,
        decimal? excellentRate,
        IReadOnlyDictionary<string, int> scoreBuckets,
        DateTimeOffset now) =>
        new(
            examSessionId,
            participantCount,
            submittedCount,
            absentCount,
            averageScore,
            maxScore,
            minScore,
            passRate,
            excellentRate,
            scoreBuckets,
            now);
}

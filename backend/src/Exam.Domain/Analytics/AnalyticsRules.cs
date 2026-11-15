namespace Exam.Domain.Analytics;

/// <summary>
/// 成绩分析的固定口径。阈值与分档写死在这里，接口、文档、前端都以此为准。
/// <para>
/// 口径基于**得分率**（总得分 ÷ 总满分），而不是绝对分：同一套阈值对 40 分卷与 100 分卷同样成立。
/// </para>
/// </summary>
public static class AnalyticsRules
{
    /// <summary>兜底及格得分率：试卷没设及格分时按这个比例算及格。</summary>
    public const decimal PassRate = 0.6m;

    /// <summary>优秀得分率：得分率达到这个比例算优秀。</summary>
    public const decimal ExcellentRate = 0.85m;

    /// <summary>讲评建议线：正确率或得分率低于这个比例就值得安排讲评。</summary>
    public const decimal ReviewSuggestionRate = 0.6m;

    /// <summary>分数段。按得分率分档，标签与前端原型一致。</summary>
    public static IReadOnlyList<ScoreBand> Bands { get; } =
    [
        new ScoreBand("90 分以上", 0.9m, 1.0001m),
        new ScoreBand("80–90", 0.8m, 0.9m),
        new ScoreBand("70–80", 0.7m, 0.8m),
        new ScoreBand("60–70", 0.6m, 0.7m),
        new ScoreBand("60 分以下", 0m, 0.6m),
    ];

    /// <summary>得分率。总满分为零时按零算。</summary>
    public static decimal ScoreRate(decimal totalScore, decimal totalMaxScore) =>
        totalMaxScore > 0m ? totalScore / totalMaxScore : 0m;

    /// <summary>
    /// 及格线（绝对分）。试卷设了及格分就按试卷的来，没设才用兜底得分率。
    /// <para>统计口径必须与学生看到的「及格分」一致，否则及格率会跟成绩单打架。</para>
    /// </summary>
    public static decimal PassThreshold(decimal totalMaxScore, decimal? paperPassScore) =>
        paperPassScore ?? totalMaxScore * PassRate;

    /// <summary>优秀线（绝对分）。</summary>
    public static decimal ExcellentThreshold(decimal totalMaxScore) => totalMaxScore * ExcellentRate;

    /// <summary>是否及格。</summary>
    public static bool IsPass(decimal totalScore, decimal threshold) => totalScore >= threshold;

    /// <summary>是否优秀。</summary>
    public static bool IsExcellent(decimal totalScore, decimal threshold) => totalScore >= threshold;

    /// <summary>是否满分。客观题判对、主观题拿满分，都算这道题的「答对」。</summary>
    public static bool IsFullMark(decimal score, decimal maxScore) => score >= maxScore;

    /// <summary>得分率落在哪一档。</summary>
    public static string BucketLabel(decimal scoreRate)
    {
        foreach (var band in Bands)
        {
            if (scoreRate >= band.LowerInclusive && scoreRate < band.UpperExclusive)
            {
                return band.Label;
            }
        }

        return Bands[^1].Label;
    }

    /// <summary>按得分率分档计数。分档顺序固定，输出顺序与 <see cref="Bands"/> 一致。</summary>
    public static IReadOnlyDictionary<string, int> CountByBucket(IEnumerable<decimal> scoreRates)
    {
        var counts = Bands.ToDictionary(b => b.Label, _ => 0);

        foreach (var rate in scoreRates)
        {
            counts[BucketLabel(rate)]++;
        }

        return counts;
    }
}

/// <summary>分数段：下界含，上界不含。</summary>
public sealed record ScoreBand(string Label, decimal LowerInclusive, decimal UpperExclusive);

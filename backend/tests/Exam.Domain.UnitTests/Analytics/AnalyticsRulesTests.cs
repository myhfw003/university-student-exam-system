using Exam.Domain.Analytics;
using Shouldly;

namespace Exam.Domain.UnitTests.Analytics;

/// <summary>
/// 成绩分析口径。
/// <para>
/// 阈值与分档是前后端共用的约定，改一处就要改全套。
/// </para>
/// </summary>
public sealed class AnalyticsRulesTests
{
    [Fact]
    public void 得分率是总得分除总满分()
    {
        AnalyticsRules.ScoreRate(76m, 100m).ShouldBe(0.76m);
        AnalyticsRules.ScoreRate(19m, 38m).ShouldBe(0.5m);
    }

    [Fact]
    public void 总满分为零时得分率为零()
    {
        AnalyticsRules.ScoreRate(10m, 0m).ShouldBe(0m);
    }

    [Fact]
    public void 及格线优先用试卷及格分()
    {
        // 试卷设了 70 分及格，就按 70 分算，不看六成得分率。
        AnalyticsRules.PassThreshold(100m, 70m).ShouldBe(70m);
    }

    [Fact]
    public void 试卷没设及格分时按六成得分率兜底()
    {
        AnalyticsRules.PassThreshold(100m, null).ShouldBe(60m);
        AnalyticsRules.PassThreshold(40m, null).ShouldBe(24m);
    }

    [Fact]
    public void 优秀线按八五得分率()
    {
        AnalyticsRules.ExcellentThreshold(100m).ShouldBe(85m);
        AnalyticsRules.ExcellentThreshold(40m).ShouldBe(34m);
    }

    [Fact]
    public void 达到线就算达标()
    {
        AnalyticsRules.IsPass(60m, 60m).ShouldBeTrue();
        AnalyticsRules.IsPass(59.99m, 60m).ShouldBeFalse();
        AnalyticsRules.IsExcellent(85m, 85m).ShouldBeTrue();
        AnalyticsRules.IsExcellent(84.99m, 85m).ShouldBeFalse();
    }

    [Theory]
    [InlineData(0.95, "90 分以上")]
    [InlineData(0.9, "90 分以上")]
    [InlineData(0.85, "80–90")]
    [InlineData(0.8, "80–90")]
    [InlineData(0.75, "70–80")]
    [InlineData(0.65, "60–70")]
    [InlineData(0.6, "60–70")]
    [InlineData(0.59, "60 分以下")]
    [InlineData(0, "60 分以下")]
    public void 得分率落在对应分数段(double rate, string expected)
    {
        AnalyticsRules.BucketLabel((decimal)rate).ShouldBe(expected);
    }

    [Fact]
    public void 分档计数把每一档都列出来()
    {
        var counts = AnalyticsRules.CountByBucket([1m, 0.85m, 0.5m]);

        counts.Count.ShouldBe(5);
        counts["90 分以上"].ShouldBe(1);
        counts["80–90"].ShouldBe(1);
        counts["60 分以下"].ShouldBe(1);
        counts["70–80"].ShouldBe(0);
        counts["60–70"].ShouldBe(0);
    }

    [Fact]
    public void 拿到满分算答对()
    {
        AnalyticsRules.IsFullMark(10m, 10m).ShouldBeTrue();
        AnalyticsRules.IsFullMark(5m, 10m).ShouldBeFalse();
        AnalyticsRules.IsFullMark(0m, 0m).ShouldBeTrue();
    }
}

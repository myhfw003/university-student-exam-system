using Exam.Domain.Learning;
using Shouldly;

namespace Exam.Domain.UnitTests.Learning;

/// <summary>
/// 掌握度算法与能力画像。
/// <para>
/// 掌握度 =（Σ 得分率² 的加权平均）/（1 + 0.1 × ln(1 + 样本量)）；
/// 样本量少于 5 就标「样本不足」，不参与排序。
/// </para>
/// </summary>
public sealed class AbilityProfileTests
{
    [Fact]
    public void 没有样本时掌握度为零()
    {
        MasteryCalculator.Calculate([]).ShouldBe(0m);
    }

    [Fact]
    public void 全部满分时掌握度接近一()
    {
        var samples = new[] { new MasterySample(1m, 10m), new MasterySample(1m, 10m) };

        var mastery = MasteryCalculator.Calculate(samples);

        // (1 × 1 + 1 × 1) / 2 / (1 + 0.1 × ln 3) ≈ 0.828
        mastery.ShouldBeGreaterThan(0.8m);
        mastery.ShouldBeLessThanOrEqualTo(1m);
    }

    [Fact]
    public void 全部零分时掌握度为零()
    {
        MasteryCalculator.Calculate([new MasterySample(0m, 10m), new MasterySample(0m, 10m)])
            .ShouldBe(0m);
    }

    [Fact]
    public void 权重大的题影响更大()
    {
        var light = MasteryCalculator.Calculate([new MasterySample(1m, 1m), new MasterySample(0m, 9m)]);
        var heavy = MasteryCalculator.Calculate([new MasterySample(1m, 9m), new MasterySample(0m, 1m)]);

        heavy.ShouldBeGreaterThan(light);
    }

    [Fact]
    public void 样本越多折扣越大()
    {
        var few = MasteryCalculator.Calculate([new MasterySample(1m, 10m)]);
        var many = MasteryCalculator.Calculate(
            Enumerable.Range(0, 20).Select(_ => new MasterySample(1m, 10m)).ToList());

        many.ShouldBeLessThan(few);
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(4, false)]
    [InlineData(5, true)]
    [InlineData(20, true)]
    public void 样本不足的判定(int sampleSize, bool expected) =>
        MasteryCalculator.IsSufficient(sampleSize).ShouldBe(expected);

    [Fact]
    public void 画像记录与更新()
    {
        var profile = AbilityProfile.Record(
            userId: 7,
            abilityTagId: 3,
            masteryRate: 0.5m,
            sampleSize: 4,
            correctCount: 2,
            now: DateTimeOffset.UtcNow);

        profile.MasteryRate.ShouldBe(0.5m);
        profile.SampleSize.ShouldBe(4);
        profile.CorrectCount.ShouldBe(2);
        profile.IsSampleSufficient.ShouldBeFalse();

        profile.Update(0.9m, 10, 6, DateTimeOffset.UtcNow);

        profile.MasteryRate.ShouldBe(0.9m);
        profile.SampleSize.ShouldBe(10);
        profile.CorrectCount.ShouldBe(6);
        profile.IsSampleSufficient.ShouldBeTrue();
    }

    [Fact]
    public void 掌握度不会越界()
    {
        var profile = AbilityProfile.Record(7, 3, 1.5m, -1, -2, DateTimeOffset.UtcNow);

        profile.MasteryRate.ShouldBe(1m);
        profile.SampleSize.ShouldBe(0);
        profile.CorrectCount.ShouldBe(0);
    }
}

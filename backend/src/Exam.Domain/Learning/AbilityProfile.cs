using Exam.Domain.SharedKernel.Entities;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Learning;

/// <summary>一条能力样本：某道题的得分率与权重。</summary>
public sealed record MasterySample(decimal Rate, decimal Weight);

/// <summary>
/// 掌握度算法（领域服务）。
/// <para>
/// 掌握度 =（Σ 得分率² 的加权平均）/（1 + 0.1 × ln(1 + 样本量)）。
/// </para>
/// <para>
/// 得分率先平方再平均：高分被放大、低分被压低，区分度比直接平均更明显；
/// 除以一个随样本量增长的因子，是给「样本还不够」的画像留出收敛空间。
/// </para>
/// </summary>
public static class MasteryCalculator
{
    /// <summary>样本量低于这个数就算「样本不足」，不参与能力排序。</summary>
    public const int MinSampleSize = 5;

    /// <summary>按公式算掌握度。0..1。</summary>
    public static decimal Calculate(IReadOnlyCollection<MasterySample> samples)
    {
        if (samples.Count == 0)
        {
            return 0m;
        }

        var weightSum = samples.Sum(s => s.Weight);
        if (weightSum <= 0m)
        {
            return 0m;
        }

        var weighted = samples.Sum(s => s.Rate * s.Rate * s.Weight) / weightSum;
        var discount = 1m + 0.1m * (decimal)Math.Log(1 + samples.Count);

        return Math.Round(weighted / discount, 4, MidpointRounding.AwayFromZero);
    }

    /// <summary>样本够不够。</summary>
    public static bool IsSufficient(int sampleSize) => sampleSize >= MinSampleSize;
}

/// <summary>
/// 能力画像。某个学生在一项能力上的掌握情况。
/// <para>
/// 由成绩定分驱动更新；样本不足的画像不参与能力排序。
/// </para>
/// </summary>
public sealed class AbilityProfile : AuditableEntity, IAuditedEntity
{
    private AbilityProfile()
    {
    }

    private AbilityProfile(
        long userId,
        long abilityTagId,
        decimal masteryRate,
        int sampleSize,
        int correctCount,
        DateTimeOffset now)
        : base(now, userId)
    {
        UserId = userId;
        AbilityTagId = abilityTagId;
        MasteryRate = masteryRate;
        SampleSize = sampleSize;
        CorrectCount = correctCount;
        Touch(now, userId);
    }

    public long UserId { get; private set; }

    /// <summary>能力标签（TagGroup.Ability）。</summary>
    public long AbilityTagId { get; private set; }

    /// <summary>掌握度，0..1。</summary>
    public decimal MasteryRate { get; private set; }

    /// <summary>样本量。</summary>
    public int SampleSize { get; private set; }

    /// <summary>完全正确的样本数。</summary>
    public int CorrectCount { get; private set; }

    /// <summary>样本够不够。不够就不参与能力排序。</summary>
    public bool IsSampleSufficient => MasteryCalculator.IsSufficient(SampleSize);

    public static AbilityProfile Record(
        long userId,
        long abilityTagId,
        decimal masteryRate,
        int sampleSize,
        int correctCount,
        DateTimeOffset now)
    {
        if (userId <= 0 || abilityTagId <= 0)
        {
            throw new BusinessRuleException("能力画像归属不合法。");
        }

        return new AbilityProfile(
            userId,
            abilityTagId,
            Math.Clamp(masteryRate, 0m, 1m),
            Math.Max(0, sampleSize),
            Math.Max(0, correctCount),
            now);
    }

    /// <summary>有新样本，重新算一遍。</summary>
    public void Update(
        decimal masteryRate,
        int sampleSize,
        int correctCount,
        DateTimeOffset now)
    {
        MasteryRate = Math.Clamp(masteryRate, 0m, 1m);
        SampleSize = Math.Max(0, sampleSize);
        CorrectCount = Math.Max(0, correctCount);
        Touch(now, UserId);
    }
}

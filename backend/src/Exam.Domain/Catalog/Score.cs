using Exam.Domain.SharedKernel.Exceptions;
using Exam.Domain.SharedKernel.ValueObjects;

namespace Exam.Domain.Catalog;

/// <summary>
/// 分值。值对象：不可变，范围受上下限约束。
/// <para>题目分值上限 40，试卷总分上限 200；保留 2 位小数。</para>
/// </summary>
public sealed class Score : ValueObject
{
    /// <summary>题目分值上限。</summary>
    public const decimal MaxQuestionScore = 40m;

    /// <summary>试卷总分上限。</summary>
    public const decimal MaxPaperScore = 200m;

    /// <summary>阅卷给分的最小步进。</summary>
    public const decimal GradingStep = 0.5m;

    private Score(decimal value) => Value = value;

    public decimal Value { get; }

    public static Score Zero { get; } = new(0m);

    /// <summary>题目默认分值。大于 0 且不超过 40。</summary>
    public static Score Question(decimal value)
    {
        if (value <= 0m)
        {
            throw new BusinessRuleException("题目分值必须大于 0。");
        }

        if (value > MaxQuestionScore)
        {
            throw new BusinessRuleException($"题目分值不能超过 {MaxQuestionScore}。");
        }

        return new Score(Round(value));
    }

    /// <summary>试卷总分。0 到 200。</summary>
    public static Score Paper(decimal value)
    {
        if (value < 0m)
        {
            throw new BusinessRuleException("试卷总分不能为负。");
        }

        if (value > MaxPaperScore)
        {
            throw new BusinessRuleException($"试卷总分不能超过 {MaxPaperScore}。");
        }

        return new Score(Round(value));
    }

    /// <summary>阅卷给分。0 到满分，且必须是 0.5 的整数倍。</summary>
    public static Score Graded(decimal value, decimal max)
    {
        if (value < 0m)
        {
            throw new BusinessRuleException("得分不能为负。");
        }

        if (value > max)
        {
            throw new BusinessRuleException($"得分不能超过满分 {Round(max)}。");
        }

        if (Math.Abs(value / GradingStep - Math.Round(value / GradingStep)) > 0.0001m)
        {
            throw new BusinessRuleException($"得分必须以 {GradingStep} 为步进。");
        }

        return new Score(Round(value));
    }

    /// <summary>按权重分配总分，余数按顺序补给前面的项，保证总和精确等于目标。</summary>
    public static IReadOnlyList<Score> Allocate(decimal total, IReadOnlyList<int> weights)
    {
        if (weights.Count == 0)
        {
            return [];
        }

        var weightSum = weights.Sum();
        if (weightSum <= 0)
        {
            throw new BusinessRuleException("分值权重之和必须大于 0。");
        }

        var raw = weights.Select(w => total * w / weightSum).ToList();
        var floored = raw.Select(v => Math.Floor(v * 2m) / 2m).ToList();

        // 0.5 为步进，因此以 0.5 为单位分配余数。
        var units = raw.Select(v => (int)Math.Round(v * 2m)).ToList();
        var targetUnits = (int)Math.Round(total * 2m);
        var current = units.Sum();
        var index = 0;

        while (current < targetUnits)
        {
            units[index % units.Count]++;
            current++;
            index++;
        }

        while (current > targetUnits)
        {
            var position = units.Count - 1 - (index % units.Count);
            if (units[position] > 0)
            {
                units[position]--;
                current--;
            }

            index++;
        }

        return units.Select(u => new Score(u / 2m)).ToList();
    }

    public static decimal Sum(IEnumerable<Score> scores) =>
        scores.Sum(s => s.Value);

    public static decimal Sum(IEnumerable<decimal> values) =>
        values.Sum();

    public override string ToString() => Round(Value).ToString("0.##");

    protected override IEnumerable<object?> GetEqualityComponents()
    {
        yield return Value;
    }

    private static decimal Round(decimal value) =>
        Math.Round(value, 2, MidpointRounding.AwayFromZero);
}

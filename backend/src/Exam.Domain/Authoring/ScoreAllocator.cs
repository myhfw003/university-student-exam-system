using Exam.Domain.Catalog;
using Exam.Domain.SharedKernel.Exceptions;

namespace Exam.Domain.Authoring;

/// <summary>分值分配模式。</summary>
public enum ScoreAllocation
{
    /// <summary>均分：cell 内每题分值相同。</summary>
    Even,

    /// <summary>按难度加权：难题分值高，简单题分值低。</summary>
    ByDifficulty,
}

/// <summary>
/// 分值分配器（领域服务）。
/// <para>
/// 目标总分被精确分配到每一项：先按权重向下取整到 0.5 的整数倍，
/// 余数再按指定顺序逐个补给靠前的项。<b>分配结果之和精确等于目标总分</b>（小数误差为 0）。
/// </para>
/// </summary>
public static class ScoreAllocator
{
    /// <summary>分值步进。阅卷给分以 0.5 为最小单位，卷面分值与之对齐。</summary>
    public const decimal Step = Score.GradingStep;

    /// <summary>均分。</summary>
    /// <param name="total">目标总分。</param>
    /// <param name="count">题目数量。</param>
    /// <param name="order">余数补给顺序，元素为题目下标。默认按题序。</param>
    /// <param name="maxPerItem">单题分值上限，可空。</param>
    public static IReadOnlyList<decimal> AllocateEven(
        decimal total,
        int count,
        IReadOnlyList<int>? order = null,
        decimal? maxPerItem = null)
    {
        if (count < 0)
        {
            throw new BusinessRuleException("题目数量不能为负。");
        }

        var weights = Enumerable.Repeat(1, count).ToList();
        return Allocate(total, weights, order, maxPerItem);
    }

    /// <summary>按权重分配。</summary>
    /// <param name="total">目标总分。</param>
    /// <param name="weights">每题的权重，必须为正数。</param>
    /// <param name="order">余数补给顺序，元素为题目下标。默认按题序。</param>
    /// <param name="maxPerItem">单题分值上限，可空。</param>
    public static IReadOnlyList<decimal> Allocate(
        decimal total,
        IReadOnlyList<int> weights,
        IReadOnlyList<int>? order = null,
        decimal? maxPerItem = null)
    {
        if (weights.Count == 0)
        {
            return [];
        }

        if (total < 0m)
        {
            throw new BusinessRuleException("目标总分不能为负。");
        }

        if (weights.Any(w => w <= 0))
        {
            throw new BusinessRuleException("分值权重必须为正数。");
        }

        // 分值以 0.5 为步进，目标总分必须落在步进上，否则无法精确分配。
        var totalUnits = ToUnits(total);
        if (totalUnits * Step != total)
        {
            throw new BusinessRuleException($"目标总分必须以 {Step} 为步进。");
        }

        var weightSum = weights.Aggregate(0L, (acc, w) => acc + w);
        var units = weights
            .Select(w => (int)Math.Floor((decimal)totalUnits * w / weightSum))
            .ToList();

        // 余数按 order 从前到后补给，每轮每题最多补一个步进。
        var sequence = BuildOrder(order, weights.Count);
        var remainder = totalUnits - units.Sum();
        var cursor = 0;
        while (remainder > 0)
        {
            units[sequence[cursor % sequence.Count]]++;
            remainder--;
            cursor++;
        }

        var result = units.Select(u => u * Step).ToList();

        if (maxPerItem is { } cap && result.Any(v => v > cap))
        {
            throw new BusinessRuleException(
                $"按当前规则分配后有题目分值超过 {cap}，请增加题目数量或调整目标总分。");
        }

        return result;
    }

    /// <summary>把分值换算成 0.5 为单位的整数。</summary>
    private static int ToUnits(decimal value)
    {
        var units = (int)Math.Round(value / Step, MidpointRounding.AwayFromZero);
        return units;
    }

    /// <summary>校验并补全余数补给顺序。</summary>
    private static IReadOnlyList<int> BuildOrder(IReadOnlyList<int>? order, int count)
    {
        if (order is null || order.Count == 0)
        {
            return Enumerable.Range(0, count).ToList();
        }

        if (order.Distinct().Count() != order.Count || order.Any(i => i < 0 || i >= count))
        {
            throw new BusinessRuleException("余数分配顺序必须是题目的一个排列。");
        }

        return order;
    }
}

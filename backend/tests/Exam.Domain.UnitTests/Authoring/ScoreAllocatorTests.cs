using Exam.Domain.Authoring;
using Exam.Domain.SharedKernel.Exceptions;
using Shouldly;

namespace Exam.Domain.UnitTests.Authoring;

public sealed class ScoreAllocatorTests
{
    [Fact]
    public void 均分结果之和精确等于目标总分()
    {
        var result = ScoreAllocator.AllocateEven(10m, 4);

        result.ShouldBe([2.5m, 2.5m, 2.5m, 2.5m]);
        result.Sum().ShouldBe(10m);
    }

    [Fact]
    public void 均分余数补给靠前的题()
    {
        var result = ScoreAllocator.AllocateEven(10m, 3);

        result.ShouldBe([3.5m, 3.5m, 3m]);
        result.Sum().ShouldBe(10m);
    }

    [Fact]
    public void 余数可以按指定顺序补给()
    {
        var result = ScoreAllocator.AllocateEven(10m, 3, [2, 0, 1]);

        result.ShouldBe([3.5m, 3m, 3.5m]);
        result.Sum().ShouldBe(10m);
    }

    [Fact]
    public void 按权重分配()
    {
        var result = ScoreAllocator.Allocate(10m, [3, 1]);

        result.ShouldBe([7.5m, 2.5m]);
        result.Sum().ShouldBe(10m);
    }

    [Fact]
    public void 权重不等分时余数按序补齐()
    {
        var result = ScoreAllocator.Allocate(10m, [2, 1, 1]);

        result.Sum().ShouldBe(10m);
        result.ShouldBe([5m, 2.5m, 2.5m]);
    }

    [Fact]
    public void 多种组合下结果之和都精确等于目标总分()
    {
        for (var count = 1; count <= 20; count++)
        {
            for (var totalUnits = count; totalUnits <= count * 8; totalUnits++)
            {
                var total = totalUnits * 0.5m;
                var even = ScoreAllocator.AllocateEven(total, count);
                even.Sum().ShouldBe(total);

                var weights = Enumerable.Range(1, count).Select(i => (i % 3) + 1).ToList();
                var weighted = ScoreAllocator.Allocate(total, weights);
                weighted.Sum().ShouldBe(total);
            }
        }
    }

    [Fact]
    public void 单题分值超过上限时报错()
    {
        var act = () => ScoreAllocator.AllocateEven(100m, 2, maxPerItem: 40m);

        var ex = act.ShouldThrow<BusinessRuleException>();
        ex.Message.ShouldContain("40");
    }

    [Fact]
    public void 目标总分不是步进整数时报错()
    {
        var act = () => ScoreAllocator.AllocateEven(10.3m, 4);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 权重必须为正数()
    {
        var act = () => ScoreAllocator.Allocate(10m, [1, 0]);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 余数顺序必须是题目的排列()
    {
        var act = () => ScoreAllocator.AllocateEven(10m, 3, [0, 0, 1]);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 分配结果不小于零()
    {
        var result = ScoreAllocator.AllocateEven(0m, 5);

        result.ShouldAllBe(v => v >= 0m);
        result.Sum().ShouldBe(0m);
    }
}

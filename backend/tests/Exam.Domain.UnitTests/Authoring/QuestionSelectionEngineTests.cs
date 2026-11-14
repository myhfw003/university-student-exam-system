using Exam.Domain.Authoring;
using Exam.Domain.Catalog;
using Exam.Domain.SharedKernel.Exceptions;
using Shouldly;

namespace Exam.Domain.UnitTests.Authoring;

public sealed class QuestionSelectionEngineTests
{
    private const long BasicDifficulty = 30;
    private const long MediumDifficulty = 31;
    private const long HardDifficulty = 32;

    private static QuestionCandidate Candidate(
        long id,
        QuestionType type = QuestionType.Single,
        long difficulty = BasicDifficulty,
        int level = 1) =>
        new(id, $"Q-{id}", type, difficulty, level, $"难度{level}");

    private static BlueprintRules Rules(
        IReadOnlyDictionary<long, int>? difficultyQuota = null,
        IReadOnlyDictionary<QuestionType, int>? typeQuota = null,
        decimal target = 20m,
        OrderRule orderRule = OrderRule.ByType,
        ScoreAllocation allocation = ScoreAllocation.Even)
    {
        var rules = new BlueprintRules
        {
            DifficultyQuota = difficultyQuota ?? new Dictionary<long, int>(),
            TypeQuota = typeQuota ?? new Dictionary<QuestionType, int>(),
            TargetTotalScore = target,
            OrderRule = orderRule,
            ScoreAllocation = allocation,
        };

        rules.EnsureValid();
        return rules;
    }

    [Fact]
    public void 同规则同种子同题池结果完全一致()
    {
        var pool = Enumerable.Range(1, 20).Select(i => Candidate(i)).ToList();
        var rules = Rules(typeQuota: new Dictionary<QuestionType, int> { [QuestionType.Single] = 5 });

        var first = QuestionSelectionEngine.Generate(rules, pool, "seed-1");
        var second = QuestionSelectionEngine.Generate(rules, pool, "seed-1");

        second.Items.Select(i => i.QuestionId).ShouldBe(first.Items.Select(i => i.QuestionId));
        second.Items.Select(i => i.Score).ShouldBe(first.Items.Select(i => i.Score));
        second.TotalScore.ShouldBe(first.TotalScore);
    }

    [Fact]
    public void 不同种子抽到的题不同()
    {
        var pool = Enumerable.Range(1, 20).Select(i => Candidate(i)).ToList();
        var rules = Rules(typeQuota: new Dictionary<QuestionType, int> { [QuestionType.Single] = 5 });

        var first = QuestionSelectionEngine.Generate(rules, pool, "seed-1");
        var second = QuestionSelectionEngine.Generate(rules, pool, "seed-2");

        second.Items.Select(i => i.QuestionId).ShouldNotBe(first.Items.Select(i => i.QuestionId));
    }

    [Fact]
    public void 分配结果之和精确等于目标总分()
    {
        var pool = Enumerable.Range(1, 30)
            .Select(i => Candidate(i, QuestionType.Single, BasicDifficulty, 1))
            .Concat(Enumerable.Range(101, 10).Select(i => Candidate(i, QuestionType.Single, MediumDifficulty, 3)))
            .ToList();
        var rules = Rules(
            difficultyQuota: new Dictionary<long, int> { [BasicDifficulty] = 3, [MediumDifficulty] = 2 },
            target: 25m);

        var plan = QuestionSelectionEngine.Generate(rules, pool, "seed-1");

        plan.Items.Count.ShouldBe(5);
        plan.TotalScore.ShouldBe(25m);
        plan.Items.Sum(i => i.Score).ShouldBe(25m);
    }

    [Fact]
    public void 题池不足时逐条列出缺口()
    {
        var pool = Enumerable.Range(1, 2).Select(i => Candidate(i)).ToList();
        var rules = Rules(
            difficultyQuota: new Dictionary<long, int> { [BasicDifficulty] = 3, [MediumDifficulty] = 2 },
            target: 25m);

        var act = () => QuestionSelectionEngine.Generate(rules, pool, "seed-1");

        var ex = act.ShouldThrow<InsufficientQuestionPoolException>();
        ex.ErrorCode.ShouldBe(ErrorCodes.InsufficientQuestionPool);
        ex.Shortfalls.Count.ShouldBe(2);

        var basic = ex.Shortfalls.Single(s => s.DifficultyTagId == BasicDifficulty);
        basic.Required.ShouldBe(3);
        basic.Available.ShouldBe(2);
        basic.Reason.ShouldContain("仅有 2 道");
    }

    [Fact]
    public void 题池不足时不降级补题()
    {
        var pool = Enumerable.Range(1, 3)
            .Select(i => Candidate(i, QuestionType.Single, BasicDifficulty))
            .ToList();
        var rules = Rules(
            typeQuota: new Dictionary<QuestionType, int> { [QuestionType.Single] = 3, [QuestionType.Multi] = 2 },
            target: 25m);

        var act = () => QuestionSelectionEngine.Generate(rules, pool, "seed-1");

        var ex = act.ShouldThrow<InsufficientQuestionPoolException>();
        ex.Shortfalls.Single(s => s.Type == QuestionType.Multi).Available.ShouldBe(0);
    }

    [Fact]
    public void 题型与难度配额同时给出时两个维度都满足()
    {
        var pool = new List<QuestionCandidate>();
        var id = 1;
        foreach (var type in QuestionTypes.All)
        {
            for (var i = 0; i < 6; i++)
            {
                pool.Add(Candidate(id++, type, BasicDifficulty, 1));
                pool.Add(Candidate(id++, type, MediumDifficulty, 3));
                pool.Add(Candidate(id++, type, HardDifficulty, 5));
            }
        }

        var rules = Rules(
            difficultyQuota: new Dictionary<long, int> { [BasicDifficulty] = 5, [MediumDifficulty] = 3, [HardDifficulty] = 2 },
            typeQuota: new Dictionary<QuestionType, int>
            {
                [QuestionType.Single] = 6,
                [QuestionType.Multi] = 2,
                [QuestionType.Judge] = 2,
            },
            target: 50m);

        var plan = QuestionSelectionEngine.Generate(rules, pool, "seed-1");

        plan.Items.Count.ShouldBe(10);
        plan.Items.Count(i => i.Type == QuestionType.Single).ShouldBe(6);
        plan.Items.Count(i => i.Type == QuestionType.Multi).ShouldBe(2);
        plan.Items.Count(i => i.Type == QuestionType.Judge).ShouldBe(2);
        plan.Items.Count(i => i.DifficultyTagId == BasicDifficulty).ShouldBe(5);
        plan.Items.Count(i => i.DifficultyTagId == MediumDifficulty).ShouldBe(3);
        plan.Items.Count(i => i.DifficultyTagId == HardDifficulty).ShouldBe(2);
        plan.TotalScore.ShouldBe(50m);
    }

    [Fact]
    public void 按题型排序时题型固定序()
    {
        var pool = new List<QuestionCandidate>();
        var id = 1;
        foreach (var type in new[] { QuestionType.Comprehensive, QuestionType.Single, QuestionType.Judge })
        {
            pool.Add(Candidate(id++, type, BasicDifficulty, 1));
        }

        var rules = Rules(
            typeQuota: new Dictionary<QuestionType, int>
            {
                [QuestionType.Single] = 1,
                [QuestionType.Judge] = 1,
                [QuestionType.Comprehensive] = 1,
            },
            target: 15m);

        var plan = QuestionSelectionEngine.Generate(rules, pool, "seed-1");

        plan.Items.Select(i => i.Type).ShouldBe([QuestionType.Single, QuestionType.Judge, QuestionType.Comprehensive]);
        plan.Items.Select(i => i.SortOrder).ShouldBe([0, 1, 2]);
    }

    [Fact]
    public void 单题分值超过上限时报错()
    {
        var pool = Enumerable.Range(1, 4).Select(i => Candidate(i)).ToList();
        var rules = Rules(
            typeQuota: new Dictionary<QuestionType, int> { [QuestionType.Single] = 2 },
            target: 100m);

        var act = () => QuestionSelectionEngine.Generate(rules, pool, "seed-1");

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 规则必须至少有一项配额()
    {
        var act = () => new BlueprintRules { TargetTotalScore = 10m }.EnsureValid();

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 题型配额之和必须等于难度配额之和()
    {
        var act = () => new BlueprintRules
        {
            DifficultyQuota = new Dictionary<long, int> { [BasicDifficulty] = 5 },
            TypeQuota = new Dictionary<QuestionType, int> { [QuestionType.Single] = 3 },
            TargetTotalScore = 10m,
        }.EnsureValid();

        act.ShouldThrow<BusinessRuleException>();
    }
}

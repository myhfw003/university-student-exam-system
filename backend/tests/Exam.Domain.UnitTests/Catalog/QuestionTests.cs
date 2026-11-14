using Exam.Domain.Catalog;
using Exam.Domain.SharedKernel.Exceptions;
using Shouldly;

namespace Exam.Domain.UnitTests.Catalog;

public sealed class QuestionTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 14, 5, 0, 0, TimeSpan.Zero);

    private static Question NewQuestion(
        QuestionType type = QuestionType.Single,
        decimal score = 5m,
        long difficultyTagId = 30)
    {
        var question = Question.CreateDraft(
            "Q-2026-00001",
            type,
            "题干",
            Score.Question(score),
            difficultyTagId,
            Now);

        return question;
    }

    [Fact]
    public void 新建题目一律是草稿()
    {
        var question = NewQuestion();

        question.Status.ShouldBe(QuestionStatus.Draft);
        question.PublishedAt.ShouldBeNull();
    }

    [Fact]
    public void 题号为空时报错()
    {
        var act = () => Question.CreateDraft(" ", QuestionType.Single, "题干", Score.Question(5), 30, Now);

        act.ShouldThrow<QuestionValidationException>();
    }

    [Fact]
    public void 未指定难度标签时报错()
    {
        var act = () => Question.CreateDraft("Q-1", QuestionType.Single, "题干", Score.Question(5), 0, Now);

        act.ShouldThrow<QuestionValidationException>();
    }

    [Fact]
    public void 单选题必须恰好一个正确项()
    {
        var question = NewQuestion();
        question.AddOption(QuestionOption.Create("A", "甲", true, 0), Now);
        question.AddOption(QuestionOption.Create("B", "乙", false, 1), Now);

        question.EnsureValid();

        question.AddOption(QuestionOption.Create("C", "丙", true, 2), Now);

        var ex = Should.Throw<QuestionValidationException>(question.EnsureValid);
        ex.Errors.ShouldContainKey("options");
    }

    [Fact]
    public void 多选题至少两个正确项()
    {
        var question = NewQuestion(QuestionType.Multi);
        question.AddOption(QuestionOption.Create("A", "甲", true, 0), Now);
        question.AddOption(QuestionOption.Create("B", "乙", true, 1), Now);

        question.EnsureValid();

        question.AddOption(QuestionOption.Create("C", "丙", false, 2), Now);
        question.ClearOptions(Now);
        question.AddOption(QuestionOption.Create("A", "甲", true, 0), Now);
        question.AddOption(QuestionOption.Create("B", "乙", false, 1), Now);

        var ex = Should.Throw<QuestionValidationException>(question.EnsureValid);
        ex.Errors.ShouldContainKey("options");
    }

    [Fact]
    public void 选项键不能重复()
    {
        var question = NewQuestion();
        question.AddOption(QuestionOption.Create("A", "甲", true, 0), Now);

        var act = () => question.AddOption(QuestionOption.Create("A", "乙", false, 1), Now);

        act.ShouldThrow<QuestionValidationException>();
    }

    [Fact]
    public void 判断题固定两个选项()
    {
        var question = NewQuestion(QuestionType.Judge);

        question.Options.Count.ShouldBe(2);
        question.Options.ShouldContain(o => o.Key == "A" && o.IsCorrect);
        question.Options.ShouldContain(o => o.Key == "B" && !o.IsCorrect);

        question.EnsureValid();
    }

    [Fact]
    public void 简答题至少一个评分要点()
    {
        var question = NewQuestion(QuestionType.Short);

        var ex = Should.Throw<QuestionValidationException>(question.EnsureValid);
        ex.Errors.ShouldContainKey("keypoints");

        question.AddKeypoint(QuestionKeypoint.Create("要点一", ["关键词"], 0), Now);
        question.EnsureValid();
    }

    [Fact]
    public void 综合题步骤分值之和必须等于题目分值()
    {
        var question = NewQuestion(QuestionType.Comprehensive, 10m);
        question.AddStep(
            QuestionStep.Create("s1", "第一步", "参考答案", ["词"], Score.Question(4m), 0),
            Now);
        question.AddStep(
            QuestionStep.Create("s2", "第二步", "参考答案", ["词"], Score.Question(5m), 1),
            Now);

        var ex = Should.Throw<QuestionValidationException>(question.EnsureValid);
        ex.Errors.ShouldContainKey("steps");

        question.ClearSteps(Now);
        question.AddStep(
            QuestionStep.Create("s1", "第一步", "参考答案", ["词"], Score.Question(4m), 0),
            Now);
        question.AddStep(
            QuestionStep.Create("s2", "第二步", "参考答案", ["词"], Score.Question(6m), 1),
            Now);

        question.EnsureValid();
    }

    [Fact]
    public void 步骤编码不能重复()
    {
        var question = NewQuestion(QuestionType.Comprehensive, 10m);
        question.AddStep(QuestionStep.Create("s1", "第一步", "答案", [], Score.Question(10m), 0), Now);

        var act = () => question.AddStep(
            QuestionStep.Create("s1", "又一个第一步", "答案", [], Score.Question(10m), 1), Now);

        act.ShouldThrow<QuestionValidationException>();
    }

    [Fact]
    public void 标签数量上限为五个()
    {
        var question = NewQuestion();

        for (var i = 1; i <= 5; i++)
        {
            question.AttachTag(i, Now);
        }

        var act = () => question.AttachTag(6, Now);
        act.ShouldThrow<QuestionValidationException>();
    }

    [Fact]
    public void 难度标签不能走普通挂载入口()
    {
        var question = NewQuestion();

        var act = () => question.AttachTag(30, Now);

        act.ShouldThrow<QuestionValidationException>();
    }

    [Fact]
    public void 发布要求内容完整()
    {
        var question = NewQuestion();

        var act = () => question.Publish(Now);
        act.ShouldThrow<QuestionValidationException>();

        question.AddOption(QuestionOption.Create("A", "甲", true, 0), Now);
        question.AddOption(QuestionOption.Create("B", "乙", false, 1), Now);
        question.Publish(Now);

        question.Status.ShouldBe(QuestionStatus.Published);
        question.PublishedAt.ShouldBe(Now);
    }

    [Fact]
    public void 草稿不能停用()
    {
        var question = NewQuestion();

        var act = () => question.Disable(Now);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 停用后可以恢复到已发布()
    {
        var question = NewQuestion();
        question.AddOption(QuestionOption.Create("A", "甲", true, 0), Now);
        question.AddOption(QuestionOption.Create("B", "乙", false, 1), Now);
        question.Publish(Now);

        question.Disable(Now);
        question.Status.ShouldBe(QuestionStatus.Disabled);

        question.Restore(Now);
        question.Status.ShouldBe(QuestionStatus.Published);
    }

    [Fact]
    public void 只有草稿可以删除()
    {
        var question = NewQuestion();
        question.EnsureDeletable();

        question.AddOption(QuestionOption.Create("A", "甲", true, 0), Now);
        question.AddOption(QuestionOption.Create("B", "乙", false, 1), Now);
        question.Publish(Now);

        var act = () => question.EnsureDeletable();
        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 切换题型会清空题型专属结构()
    {
        var question = NewQuestion(QuestionType.Single);
        question.AddOption(QuestionOption.Create("A", "甲", true, 0), Now);

        question.ChangeType(QuestionType.Judge, Now);

        question.Type.ShouldBe(QuestionType.Judge);
        question.Options.Count.ShouldBe(2);
        question.Options.ShouldContain(o => o.Key == "A" && o.IsCorrect);
    }

    [Fact]
    public void 题目分值上限为四十()
    {
        var act = () => Score.Question(41m);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 阅卷给分必须是零点五的整数倍()
    {
        Score.Graded(7.5m, 10m).Value.ShouldBe(7.5m);

        var act = () => Score.Graded(7.3m, 10m);
        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 阅卷给分不能超过满分()
    {
        var act = () => Score.Graded(11m, 10m);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 分值分配总和精确等于目标()
    {
        var allocated = Score.Allocate(100m, [1, 1, 1]);

        allocated.Count.ShouldBe(3);
        allocated.Sum(s => s.Value).ShouldBe(100m);
        allocated.ShouldAllBe(s => s.Value >= 0m);
    }

    [Fact]
    public void 分值分配处理无法整除的余数()
    {
        var allocated = Score.Allocate(10m, [1, 1, 1]);

        allocated.Sum(s => s.Value).ShouldBe(10m);
        allocated.ShouldAllBe(s => s.Value >= 0m);
    }

    [Fact]
    public void 分值分配按权重拉开差距()
    {
        var allocated = Score.Allocate(100m, [3, 1]);

        allocated[0].Value.ShouldBeGreaterThan(allocated[1].Value);
        allocated.Sum(s => s.Value).ShouldBe(100m);
    }
}

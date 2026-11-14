using Exam.Domain.Authoring;
using Exam.Domain.Catalog;
using Exam.Domain.SharedKernel.Entities;
using Exam.Domain.SharedKernel.Exceptions;
using Shouldly;

namespace Exam.Domain.UnitTests.Authoring;

public sealed class PaperTemplateTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 14, 6, 0, 0, TimeSpan.Zero);

    private static Question PublishedQuestion(long id, string code)
    {
        var question = Question.CreateDraft(code, QuestionType.Single, "题干", Score.Question(5), 30, Now);
        typeof(Entity<long>).GetProperty(nameof(Entity<long>.Id))!.SetValue(question, id);
        question.AddOption(QuestionOption.Create("A", "甲", true, 0), Now);
        question.AddOption(QuestionOption.Create("B", "乙", false, 1), Now);
        question.Publish(Now);
        return question;
    }

    private static Question DisabledQuestion(long id, string code)
    {
        var question = PublishedQuestion(id, code);
        question.Disable(Now);
        return question;
    }

    [Fact]
    public void 由试卷另存模板保留形态卷型时长与题位()
    {
        var paper = Paper.CreateDraft(PaperKind.Exam, "期末考试", Now);
        paper.AddItem(PublishedQuestion(1, "Q-1"), Score.Question(5), 0, Now);
        paper.AddItem(PublishedQuestion(2, "Q-2"), Score.Question(7.5m), 1, Now);

        var template = PaperTemplate.CreateFrom(paper, "期末模板", Now);

        template.Name.ShouldBe("期末模板");
        template.Kind.ShouldBe(PaperKind.Exam);
        template.VariantRule.ShouldBe(VariantRule.Standard);
        template.DurationMinutes.ShouldBe(60);
        template.Items.Count.ShouldBe(2);
        template.TotalScore.ShouldBe(12.5m);
        template.SourcePaperId.ShouldBe(paper.Id);
    }

    [Fact]
    public void 套用模板会替换目标试卷的题位()
    {
        var source = Paper.CreateDraft(PaperKind.Exam, "期末考试", Now);
        source.AddItem(PublishedQuestion(1, "Q-1"), Score.Question(5), 0, Now);
        source.AddItem(PublishedQuestion(2, "Q-2"), Score.Question(7.5m), 1, Now);
        var template = PaperTemplate.CreateFrom(source, "期末模板", Now);

        var target = Paper.CreateDraft(PaperKind.Exam, "目标试卷", Now);
        target.AddItem(PublishedQuestion(3, "Q-3"), Score.Question(10), 0, Now);

        var result = template.ApplyTo(
            target,
            [
                new TemplateQuestionInfo(PublishedQuestion(1, "Q-1"), true, null),
                new TemplateQuestionInfo(PublishedQuestion(2, "Q-2"), true, null),
            ],
            Now);

        result.AppliedCount.ShouldBe(2);
        result.SkippedCount.ShouldBe(0);
        result.TotalScore.ShouldBe(12.5m);
        target.Items.Count.ShouldBe(2);
        target.Items.Select(i => i.QuestionId).ShouldBe([1, 2]);
        target.TotalItemScore.ShouldBe(12.5m);
    }

    [Fact]
    public void 已停用题目会被跳过并报告清单()
    {
        var source = Paper.CreateDraft(PaperKind.Exam, "期末考试", Now);
        source.AddItem(PublishedQuestion(1, "Q-1"), Score.Question(5), 0, Now);
        source.AddItem(PublishedQuestion(2, "Q-2"), Score.Question(5), 1, Now);
        var template = PaperTemplate.CreateFrom(source, "期末模板", Now);

        var target = Paper.CreateDraft(PaperKind.Exam, "目标试卷", Now);

        var result = template.ApplyTo(
            target,
            [
                new TemplateQuestionInfo(PublishedQuestion(1, "Q-1"), true, null),
                new TemplateQuestionInfo(DisabledQuestion(2, "Q-2"), false, "题目已停用"),
            ],
            Now);

        result.AppliedCount.ShouldBe(1);
        result.SkippedCount.ShouldBe(1);
        result.Skipped.Single().QuestionId.ShouldBe(2);
        result.Skipped.Single().Code.ShouldBe("Q-2");
        result.Skipped.Single().Reason.ShouldBe("题目已停用");
        target.Items.Count.ShouldBe(1);
    }

    [Fact]
    public void 形态不一致的模板不能套用()
    {
        var source = Paper.CreateDraft(PaperKind.Exam, "期末考试", Now);
        source.AddItem(PublishedQuestion(1, "Q-1"), Score.Question(5), 0, Now);
        var template = PaperTemplate.CreateFrom(source, "期末模板", Now);

        var target = Paper.CreateDraft(PaperKind.Practice, "练习卷", Now);

        var act = () => template.ApplyTo(target, [], Now);

        act.ShouldThrow<BusinessRuleException>();
    }

    [Fact]
    public void 套用模板会同步目标试卷的目标总分与卷型()
    {
        var source = Paper.CreateDraft(PaperKind.Exam, "期末考试", Now);
        source.AddItem(PublishedQuestion(1, "Q-1"), Score.Question(5), 0, Now);
        source.SetVariantRule(VariantRule.SmallPlum, Now);
        var template = PaperTemplate.CreateFrom(source, "期末模板", Now);

        var target = Paper.CreateDraft(PaperKind.Exam, "目标试卷", Now);

        template.ApplyTo(target, [new TemplateQuestionInfo(PublishedQuestion(1, "Q-1"), true, null)], Now);

        target.TargetTotalScore.Value.ShouldBe(5m);
        target.VariantRule.ShouldBe(VariantRule.SmallPlum);
    }
}

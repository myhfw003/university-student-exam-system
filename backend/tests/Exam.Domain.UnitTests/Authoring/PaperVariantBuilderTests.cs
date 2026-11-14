using Exam.Domain.Authoring;
using Exam.Domain.Catalog;
using Exam.Domain.SharedKernel.Entities;
using Shouldly;

namespace Exam.Domain.UnitTests.Authoring;

public sealed class PaperVariantBuilderTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 14, 6, 0, 0, TimeSpan.Zero);

    private static Question Single(long id, string code)
    {
        var question = Question.CreateDraft(code, QuestionType.Single, "题干", Score.Question(5), 30, Now);
        typeof(Entity<long>).GetProperty(nameof(Entity<long>.Id))!.SetValue(question, id);
        question.AddOption(QuestionOption.Create("A", "甲", true, 0), Now);
        question.AddOption(QuestionOption.Create("B", "乙", false, 1), Now);
        question.AddOption(QuestionOption.Create("C", "丙", false, 2), Now);
        question.AddOption(QuestionOption.Create("D", "丁", false, 3), Now);
        question.Publish(Now);
        return question;
    }

    private static Question Judge(long id, string code)
    {
        var question = Question.CreateDraft(code, QuestionType.Judge, "题干", Score.Question(5), 30, Now);
        typeof(Entity<long>).GetProperty(nameof(Entity<long>.Id))!.SetValue(question, id);
        question.Publish(Now);
        return question;
    }

    private static PaperSnapshot Snapshot(params Question[] questions)
    {
        var paper = Paper.CreateDraft(PaperKind.Exam, "期末考试", Now);
        var order = 0;
        foreach (var question in questions)
        {
            paper.AddItem(question, Score.Question(5), order++, Now);
        }

        return PaperSnapshot.Create(paper, questions, 1, Now);
    }

    [Fact]
    public void 标准卷题序与选项都不变()
    {
        var snapshot = Snapshot(Single(1, "Q-1"), Single(2, "Q-2"));

        var variant = PaperVariantBuilder.Build(snapshot, VariantRule.Standard, "student-1", "session-1");

        variant.VariantKey.ShouldBe("STD");
        variant.Items.Select(i => i.QuestionId).ShouldBe([1, 2]);
        variant.Items[0].OptionOrder.ShouldBe(["A", "B", "C", "D"]);
    }

    [Fact]
    public void 小梅花题序不变但选项打乱()
    {
        var snapshot = Snapshot(Single(1, "Q-1"), Single(2, "Q-2"));

        var variant = PaperVariantBuilder.Build(snapshot, VariantRule.SmallPlum, "student-1", "session-1");

        variant.Items.Select(i => i.QuestionId).ShouldBe([1, 2]);
        variant.Items[0].OptionOrder.ShouldNotBe(["A", "B", "C", "D"]);
        variant.Items[0].OptionOrder.OrderBy(k => k).ShouldBe(["A", "B", "C", "D"]);
    }

    [Fact]
    public void 判断题不参与置换()
    {
        var snapshot = Snapshot(Judge(1, "Q-1"), Single(2, "Q-2"));

        var variant = PaperVariantBuilder.Build(snapshot, VariantRule.SmallPlum, "student-1", "session-1");

        var judge = variant.Items.Single(i => i.QuestionId == 1);
        judge.OptionOrder.ShouldBe(["A", "B"]);
    }

    [Fact]
    public void 同考生同场次必得同一卷面()
    {
        var snapshot = Snapshot(Single(1, "Q-1"), Single(2, "Q-2"), Single(3, "Q-3"));

        var first = PaperVariantBuilder.Build(snapshot, VariantRule.SmallPlum, "student-1", "session-1");
        var second = PaperVariantBuilder.Build(snapshot, VariantRule.SmallPlum, "student-1", "session-1");

        second.VariantKey.ShouldBe(first.VariantKey);
        second.Items.Select(i => (i.QuestionId, string.Join(",", i.OptionOrder)))
            .ShouldBe(first.Items.Select(i => (i.QuestionId, string.Join(",", i.OptionOrder))));
    }

    [Fact]
    public void 不同考生卷面不同()
    {
        var snapshot = Snapshot(Single(1, "Q-1"), Single(2, "Q-2"), Single(3, "Q-3"), Single(4, "Q-4"));

        var first = PaperVariantBuilder.Build(snapshot, VariantRule.SmallPlum, "student-1", "session-1");
        var second = PaperVariantBuilder.Build(snapshot, VariantRule.SmallPlum, "student-2", "session-1");

        first.VariantKey.ShouldNotBe(second.VariantKey);
        first.Items.Select(i => string.Join(",", i.OptionOrder))
            .ShouldNotBe(second.Items.Select(i => string.Join(",", i.OptionOrder)));
    }

    [Fact]
    public void 大梅花保留题型块顺序但块内题序打乱()
    {
        var single1 = Single(1, "Q-1");
        var single2 = Single(2, "Q-2");
        var judge1 = Judge(3, "Q-3");
        var snapshot = Snapshot(single1, single2, judge1);

        var variant = PaperVariantBuilder.Build(snapshot, VariantRule.LargePlum, "student-1", "session-1");

        // 题型块顺序保留：单选块在前，判断题块在后。
        var types = variant.Items.Select(i => i.QuestionType).ToList();
        types.IndexOf(QuestionType.Judge).ShouldBeGreaterThan(types.IndexOf(QuestionType.Single));
        variant.Items.Select(i => i.QuestionId).Distinct().Count().ShouldBe(3);
    }

    [Fact]
    public void 卷面标识由考生与场次派生()
    {
        var key = PaperVariantBuilder.DeriveVariantKey("student-1", "session-1");

        key.ShouldStartWith("VP-");
        key.ShouldBe(PaperVariantBuilder.DeriveVariantKey("student-1", "session-1"));
        key.ShouldNotBe(PaperVariantBuilder.DeriveVariantKey("student-2", "session-1"));
    }
}
